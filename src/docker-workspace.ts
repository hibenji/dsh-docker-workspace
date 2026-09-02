import { cp, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { assertDockerAvailable, docker, runCommand } from './docker-cli.js'
import { resolveConfig, type DockerWorkspaceConfig, type ResolvedDockerWorkspaceConfig } from './config.js'
import { isInsideHost, safeSessionSlug, sourcePathToContainer, stagingPathToContainer } from './paths.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dockerWorkspace: DockerWorkspaceRuntime
  }
}

export interface DockerSessionWorkspace {
  sessionId: string
  sourceRoot: string
  sessionRoot: string
  hostWorkspace: string
  containerWorkspace: string
  containerName: string
  helperPath: string
}

interface WorkspaceMeta {
  sessionId: string
  sourceRoot: string
  createdAt: string
  seededFromSession?: string
}

interface SubagentAliasMeta {
  sessionId: string
  ownerSessionId: string
  sourceRoot: string
}

export const name = 'docker-workspace'

export const Config: z<DockerWorkspaceConfig> = z.object({
  image: z.string(),
  autoBuildImage: z.boolean(),
  workspaceRoot: z.string(),
  containerWorkspace: z.string(),
  containerPrefix: z.string(),
  network: z.string(),
  removeContainerOnAgentDispose: z.boolean(),
  keepWorkspace: z.boolean(),
  copyNodeModules: z.boolean(),
})

const PROCESS_WRAPPER = `#!/bin/sh
set -eu
pidfile="$1"
shift
mkdir -p "$(dirname "$pidfile")"
exec setsid sh -c 'echo $$ > "$1"; shift; exec "$@"' dsh-docker "$pidfile" "$@"
`

export class DockerWorkspaceRuntime extends Service {
  static Config = Config

  readonly config: ResolvedDockerWorkspaceConfig
  /** Per live Agent Session binding. Subagents may point at a parent's owner state. */
  private readonly sessions = new Map<string, Promise<DockerSessionWorkspace>>()
  /** Underlying execution worlds, one per ordinary/forked chat rather than per subagent. */
  private readonly ownerStates = new Map<string, Promise<DockerSessionWorkspace>>()
  /** Live Session -> execution-world owner identity. */
  private readonly sessionOwners = new Map<string, string>()
  /** Live members retaining each execution world (owner chat plus its subagents). */
  private readonly members = new Map<string, Set<string>>()
  private readonly ready = new Map<string, DockerSessionWorkspace>()
  private readonly disposals = new Map<string, Promise<void>>()
  private imageReady?: Promise<void>

  constructor(ctx: Context, config: DockerWorkspaceConfig = {}) {
    super(ctx, 'dockerWorkspace')
    this.config = resolveConfig(config)

    ctx.on('agent/created', ({ agent }) => {
      const sourceRoot = agent.session.header.cwd
      if (sourceRoot === undefined) return
      void this.workspaceFor(agent.id, sourceRoot, agent.session.header.parentSession, agent.session.header.origin).catch(error => {
        ctx.logger.warn(`docker-workspace: preparation failed for ${agent.id}: ${String(error)}`)
      })
    })

    ctx.on('agent/pre-step', async ({ agent }, next) => {
      const sourceRoot = agent.session.header.cwd
      if (sourceRoot === undefined) {
        throw new Error(`docker-workspace: session ${agent.id} has no working directory`)
      }
      await this.workspaceFor(agent.id, sourceRoot, agent.session.header.parentSession, agent.session.header.origin)
      return next()
    })

    ctx.on('agent/disposed', ({ agent }) => {
      if (!this.sessions.has(agent.id)) return
      void this.disposeSession(agent.id).catch(error => {
        ctx.logger.warn(`docker-workspace: cleanup failed for ${agent.id}: ${String(error)}`)
      })
    })

    ctx.effect(() => async () => {
      const ids = [...this.sessions.keys()]
      await Promise.allSettled(ids.map(id => this.disposeSession(id, false)))
      // A failed/partial Session teardown must not leave an owner world behind.
      await Promise.allSettled([...this.ownerStates.keys()].map(id => this.disposeOwner(id, false)))
    }, 'docker workspace teardown')
  }

  currentIdentity(): { sessionId: string; sourceRoot: string; parentSession?: string; origin?: string } {
    const agent = this.ctx.agent
    if (agent === undefined) {
      throw new Error('docker-workspace: operation has no calling Agent; the Docker execution world is session-scoped')
    }
    const sourceRoot = agent.session.header.cwd
    if (sourceRoot === undefined) {
      throw new Error(`docker-workspace: session ${agent.id} has no working directory`)
    }
    return {
      sessionId: agent.id,
      sourceRoot: resolve(sourceRoot),
      ...(agent.session.header.parentSession === undefined ? {} : { parentSession: agent.session.header.parentSession }),
      ...(agent.session.header.origin === undefined ? {} : { origin: agent.session.header.origin }),
    }
  }

  workspace(): Promise<DockerSessionWorkspace> {
    const { sessionId, sourceRoot, parentSession, origin } = this.currentIdentity()
    return this.workspaceFor(sessionId, sourceRoot, parentSession, origin)
  }

  peekWorkspace(): DockerSessionWorkspace | undefined {
    const agent = this.ctx.agent
    return agent === undefined ? undefined : this.ready.get(agent.id)
  }

  workspaceFor(
    sessionId: string,
    sourceRoot: string,
    parentSession?: string,
    origin?: string,
  ): Promise<DockerSessionWorkspace> {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) return existing

    const pending = (async () => {
      const normalizedSource = resolve(sourceRoot)
      const ownerSessionId = origin === 'subagent' && parentSession !== undefined
        ? await this.ownerForSubagent(sessionId, parentSession, normalizedSource)
        : sessionId

      this.sessionOwners.set(sessionId, ownerSessionId)
      let ownerMembers = this.members.get(ownerSessionId)
      if (ownerMembers === undefined) {
        ownerMembers = new Set<string>()
        this.members.set(ownerSessionId, ownerMembers)
      }
      ownerMembers.add(sessionId)

      const disposing = this.disposals.get(ownerSessionId)
      if (disposing !== undefined) await disposing

      let owner = this.ownerStates.get(ownerSessionId)
      if (owner === undefined) {
        // Only ordinary/forked chats own worlds. A subagent whose parent world
        // is not currently live reconstructs that durable owner's snapshot.
        const seedFrom = ownerSessionId === sessionId ? parentSession : undefined
        owner = this.createWorkspace(ownerSessionId, normalizedSource, seedFrom)
          .catch(error => {
            if (this.ownerStates.get(ownerSessionId) === owner) this.ownerStates.delete(ownerSessionId)
            throw error
          })
        this.ownerStates.set(ownerSessionId, owner)
      }
      return await owner
    })().then(state => {
      this.ready.set(sessionId, state)
      return state
    }).catch(error => {
      if (this.sessions.get(sessionId) === pending) this.sessions.delete(sessionId)
      this.ready.delete(sessionId)
      const owner = this.sessionOwners.get(sessionId)
      this.sessionOwners.delete(sessionId)
      if (owner !== undefined) this.releaseMember(owner, sessionId)
      throw error
    })
    this.sessions.set(sessionId, pending)
    return pending
  }

  private async ownerForSubagent(sessionId: string, parentSession: string, sourceRoot: string): Promise<string> {
    const liveOwner = this.sessionOwners.get(parentSession)
    if (liveOwner !== undefined) {
      await this.writeAlias(sessionId, liveOwner, sourceRoot)
      return liveOwner
    }
    const parentAlias = await this.readAlias(parentSession)
    const ownerSessionId = parentAlias?.ownerSessionId ?? parentSession
    const existingAlias = await this.readAlias(sessionId)
    if (existingAlias !== undefined) {
      if (resolve(existingAlias.sourceRoot) !== sourceRoot) {
        throw new Error(`docker-workspace: persisted subagent ${sessionId} belongs to ${existingAlias.sourceRoot}, not ${sourceRoot}`)
      }
      if (existingAlias.ownerSessionId !== ownerSessionId) {
        throw new Error(`docker-workspace: persisted subagent ${sessionId} belongs to execution world ${existingAlias.ownerSessionId}, not ${ownerSessionId}`)
      }
    } else {
      await this.writeAlias(sessionId, ownerSessionId, sourceRoot)
    }
    return ownerSessionId
  }

  private aliasPath(sessionId: string): string {
    return join(this.config.workspaceRoot, '.subagent-aliases', `${safeSessionSlug(sessionId)}.json`)
  }

  private async readAlias(sessionId: string): Promise<SubagentAliasMeta | undefined> {
    const alias = await readJson<SubagentAliasMeta>(this.aliasPath(sessionId))
    if (alias !== undefined && alias.sessionId !== sessionId) {
      throw new Error(`docker-workspace: subagent alias collision for ${sessionId}`)
    }
    return alias
  }

  private async writeAlias(sessionId: string, ownerSessionId: string, sourceRoot: string): Promise<void> {
    const path = this.aliasPath(sessionId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify({ sessionId, ownerSessionId, sourceRoot } satisfies SubagentAliasMeta, null, 2)}\n`, 'utf8')
  }

  private releaseMember(ownerSessionId: string, sessionId: string): number {
    const members = this.members.get(ownerSessionId)
    if (members === undefined) return 0
    members.delete(sessionId)
    if (members.size === 0) this.members.delete(ownerSessionId)
    return members.size
  }

  private async createWorkspace(sessionId: string, sourceRoot: string, parentSession?: string): Promise<DockerSessionWorkspace> {
    const sourceInfo = await stat(sourceRoot).catch(error => {
      throw new Error(`docker-workspace: source project is unavailable: ${sourceRoot}: ${String(error)}`, { cause: error })
    })
    if (!sourceInfo.isDirectory()) throw new Error(`docker-workspace: source project is not a directory: ${sourceRoot}`)
    if (isInsideHost(sourceRoot, this.config.workspaceRoot)) {
      throw new Error(`docker-workspace: workspaceRoot must not be inside the source project: ${this.config.workspaceRoot}`)
    }
    await this.ensureImage()
    const slug = safeSessionSlug(sessionId)
    const sessionRoot = join(this.config.workspaceRoot, slug)
    const hostWorkspace = join(sessionRoot, 'workspace')
    const metaPath = join(sessionRoot, 'meta.json')
    const helperPath = join(sessionRoot, 'runtime', 'process-wrapper.sh')
    const containerName = `${this.config.containerPrefix}${slug}`.slice(0, 62)

    await mkdir(sessionRoot, { recursive: true })
    const oldMeta = await readJson<WorkspaceMeta>(metaPath)
    if (oldMeta !== undefined && resolve(oldMeta.sourceRoot) !== sourceRoot) {
      throw new Error(`docker-workspace: persisted session ${sessionId} belongs to ${oldMeta.sourceRoot}, not ${sourceRoot}`)
    }
    if (!(await exists(hostWorkspace))) {
      const temp = `${hostWorkspace}.tmp-${process.pid}-${Date.now()}`
      await rm(temp, { recursive: true, force: true })
      const parentWorkspace = parentSession === undefined
        ? undefined
        : join(this.config.workspaceRoot, safeSessionSlug(parentSession), 'workspace')
      const seedRoot = parentWorkspace !== undefined && await exists(parentWorkspace)
        ? parentWorkspace
        : sourceRoot
      try {
        if (seedRoot === sourceRoot) await this.snapshotSourceProject(sourceRoot, temp)
        else await this.copyTree(seedRoot, temp, true)
        await rename(temp, hostWorkspace)
      } catch (error) {
        await rm(temp, { recursive: true, force: true }).catch(() => {})
        throw new Error(`docker-workspace: failed to snapshot project ${seedRoot}: ${String(error)}`, { cause: error })
      }
    }
    const meta: WorkspaceMeta = {
      sessionId,
      sourceRoot,
      createdAt: oldMeta?.createdAt ?? new Date().toISOString(),
      ...(parentSession === undefined ? {} : { seededFromSession: parentSession }),
    }
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    await mkdir(dirname(helperPath), { recursive: true })
    await writeFile(helperPath, PROCESS_WRAPPER, { encoding: 'utf8', mode: 0o755 })

    const state: DockerSessionWorkspace = {
      sessionId,
      sourceRoot,
      sessionRoot,
      hostWorkspace,
      containerWorkspace: this.config.containerWorkspace,
      containerName,
      helperPath,
    }
    await this.ensureContainer(state)
    return state
  }

  private async snapshotSourceProject(sourceRoot: string, destination: string): Promise<void> {
    let gitEntry: Awaited<ReturnType<typeof lstat>> | undefined
    try {
      gitEntry = await lstat(join(sourceRoot, '.git'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (gitEntry === undefined || gitEntry.isDirectory()) {
      await this.copyTree(sourceRoot, destination, true)
      return
    }

    // Linked Git worktrees store `.git` as a pointer into another checkout.
    // Copying that pointer into Docker would leave a broken host-only path, so
    // materialize an independent local clone and then overlay tracked,
    // modified, untracked, and ignored project files from the worktree.
    const clone = await runCommand('git', ['clone', '--no-hardlinks', sourceRoot, destination])
    if (clone.code !== 0) {
      throw new Error(`cannot materialize linked Git worktree: ${clone.stderr.trim() || clone.stdout.trim()}`)
    }
    const origin = await runCommand('git', ['-C', sourceRoot, 'config', '--get', 'remote.origin.url'])
    if (origin.code === 0 && origin.stdout.trim() !== '') {
      const setOrigin = await runCommand('git', ['-C', destination, 'remote', 'set-url', 'origin', origin.stdout.trim()])
      if (setOrigin.code !== 0) {
        throw new Error(`cannot restore Git origin URL: ${setOrigin.stderr.trim() || setOrigin.stdout.trim()}`)
      }
    }
    await this.copyTree(sourceRoot, destination, false)
  }

  private async copyTree(sourceRoot: string, destination: string, includeGit: boolean): Promise<void> {
    await cp(sourceRoot, destination, {
      recursive: true,
      force: true,
      errorOnExist: false,
      verbatimSymlinks: true,
      filter: source => this.shouldCopy(sourceRoot, source, includeGit),
    })
  }

  private shouldCopy(sourceRoot: string, candidate: string, includeGit: boolean): boolean {
    const rel = relative(sourceRoot, candidate)
    if (rel === '') return true
    const parts = rel.split(sep)
    if (!includeGit && parts.some(part => part === '.git')) return false
    if (parts.some(part => part === '.dsh-spill')) return false
    if (this.config.copyNodeModules) return true
    return !parts.some(part => part === 'node_modules' || part === '.venv' || part === 'venv')
  }

  private ensureImage(): Promise<void> {
    this.imageReady ??= (async () => {
      await assertDockerAvailable()
      const found = await docker(['image', 'inspect', this.config.image], { allowFailure: true })
      if (found.code === 0) return
      if (!this.config.autoBuildImage) {
        throw new Error(`docker-workspace: image ${this.config.image} does not exist and autoBuildImage is disabled`)
      }
      const dockerfile = fileURLToPath(new URL('../docker/Dockerfile', import.meta.url))
      const contextDir = dirname(dockerfile)
      await docker(['build', '--pull', '-t', this.config.image, '-f', dockerfile, contextDir])
    })()
    return this.imageReady
  }

  private async ensureContainer(state: DockerSessionWorkspace): Promise<void> {
    const inspected = await docker([
      'inspect', '-f', '{{.State.Running}}|{{index .Config.Labels "io.deepseek-harness.session"}}', state.containerName,
    ], { allowFailure: true })
    if (inspected.code === 0) {
      const [running, owner] = inspected.stdout.trim().split('|')
      if (owner !== state.sessionId) {
        await docker(['rm', '-f', state.containerName])
      } else {
        if (running !== 'true') await docker(['start', state.containerName])
        await this.assertContainerRuntime(state)
        return
      }
    }

    await docker([
      'create',
      '--name', state.containerName,
      '--hostname', state.containerName,
      '--label', `io.deepseek-harness.session=${state.sessionId}`,
      '--label', 'io.deepseek-harness.runtime=docker-workspace',
      '--network', this.config.network,
      '--init',
      '--workdir', state.containerWorkspace,
      '--mount', `type=bind,source=${state.hostWorkspace},target=${state.containerWorkspace}`,
      '--mount', `type=bind,source=${state.helperPath},target=/opt/dsh-docker/process-wrapper.sh,readonly`,
      this.config.image,
      'sleep', 'infinity',
    ])
    await docker(['start', state.containerName])
    try {
      await this.assertContainerRuntime(state)
    } catch (error) {
      await docker(['rm', '-f', state.containerName], { allowFailure: true })
      throw error
    }
  }

  private async assertContainerRuntime(state: DockerSessionWorkspace): Promise<void> {
    const required = ['sh', 'setsid', 'env', 'mkdir', 'dirname']
    const check = await docker([
      'exec', state.containerName, 'sh', '-c',
      'for x in "$@"; do command -v "$x" >/dev/null 2>&1 || { echo "missing:$x" >&2; exit 127; }; done',
      'dsh-runtime-check', ...required,
    ], { allowFailure: true })
    if (check.code !== 0) {
      throw new Error(
        `docker-workspace: image ${this.config.image} is missing required process runtime tools (sh, setsid, env, mkdir, dirname): `
        + `${check.stderr.trim() || check.stdout.trim() || `exit ${check.code}`}`,
      )
    }
  }

  sourceToContainer(state: DockerSessionWorkspace, path: string): string | undefined {
    return sourcePathToContainer(state.sourceRoot, path, state.containerWorkspace)
      ?? stagingPathToContainer(state.hostWorkspace, path, state.containerWorkspace)
  }

  disposeSession(sessionId: string, honorKeep = true): Promise<void> {
    const pending = this.sessions.get(sessionId)
    if (pending === undefined) return Promise.resolve()
    const ownerSessionId = this.sessionOwners.get(sessionId) ?? sessionId

    this.sessions.delete(sessionId)
    this.ready.delete(sessionId)
    this.sessionOwners.delete(sessionId)
    const remaining = this.releaseMember(ownerSessionId, sessionId)
    if (remaining > 0) return Promise.resolve()
    return this.disposeOwner(ownerSessionId, honorKeep)
  }

  private disposeOwner(ownerSessionId: string, honorKeep: boolean): Promise<void> {
    const active = this.disposals.get(ownerSessionId)
    if (active !== undefined) return active
    // A new member may have retained the world after the caller decided to
    // dispose it but before this method acquired ownership.
    if ((this.members.get(ownerSessionId)?.size ?? 0) > 0) return Promise.resolve()
    const pending = this.ownerStates.get(ownerSessionId)
    if (pending === undefined) return Promise.resolve()
    this.ownerStates.delete(ownerSessionId)

    const disposal = (async () => {
      let state: DockerSessionWorkspace
      try {
        state = await pending
      } catch {
        return
      }
      // Re-check after awaiting creation: a rapid resume/subagent start can
      // retain the same owner while setup was settling.
      if ((this.members.get(ownerSessionId)?.size ?? 0) > 0) {
        this.ownerStates.set(ownerSessionId, Promise.resolve(state))
        return
      }
      if (this.config.removeContainerOnAgentDispose) {
        await docker(['rm', '-f', state.containerName], { allowFailure: true })
      }
      if (honorKeep && !this.config.keepWorkspace) {
        await rm(state.sessionRoot, { recursive: true, force: true })
      }
    })().finally(() => {
      if (this.disposals.get(ownerSessionId) === disposal) this.disposals.delete(ownerSessionId)
    })
    this.disposals.set(ownerSessionId, disposal)
    return disposal
  }

}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export default DockerWorkspaceRuntime
