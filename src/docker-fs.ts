import { posix } from 'node:path'
import { FsError, type FsDirEntry, type FsPathInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { Context } from '@deepseek-ai/cordis'
import { stagingPathToContainer, translateInputPath } from './paths.js'
import type { DockerSessionWorkspace } from './docker-workspace.js'
import type {} from './docker-workspace.js'

export const name = 'docker-fs'
export const inject = ['dockerWorkspace']

export class DockerFileSystem extends LocalFileSystem {
  static inject = ['dockerWorkspace']
  private readonly processPaths = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx, { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 })
  }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const state = await this.ctx.dockerWorkspace.workspace()
    let hostPath: string
    try {
      hostPath = translateInputPath(path, opts?.cwd, state.sourceRoot, state.hostWorkspace, state.containerWorkspace)
    } catch (error) {
      throw new FsError(error instanceof Error ? error.message : String(error), 'FS_PERMISSION_DENIED', { cause: error })
    }
    const local = await super.resolve(hostPath, { signal: opts?.signal })
    return this.expose(state, local)
  }

  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    const state = await this.ctx.dockerWorkspace.workspace()
    let hostPath: string
    try {
      hostPath = translateInputPath(path, opts?.cwd, state.sourceRoot, state.hostWorkspace, state.containerWorkspace)
    } catch (error) {
      throw new FsError(error instanceof Error ? error.message : String(error), 'FS_PERMISSION_DENIED', { cause: error })
    }
    return super.lstat(hostPath, undefined, signal)
  }

  override processPath(target: FsTarget): string {
    const cached = this.processPaths.get(String(target.targetKey))
    if (cached !== undefined) return cached
    if (target.displayPath.startsWith('/')) return target.displayPath
    throw new Error(`docker-fs: unknown target ${String(target.targetKey)}; resolve it through this provider before using processPath()`)
  }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    const rel = posix.relative(this.processPath(parent), this.processPath(child))
    return rel === '' || (rel !== '..' && !rel.startsWith('../') && !posix.isAbsolute(rel))
  }

  processPathFromHostPath(hostPath: string): string | undefined {
    const state = this.ctx.dockerWorkspace.peekWorkspace()
    if (state === undefined) return undefined
    return this.ctx.dockerWorkspace.sourceToContainer(state, hostPath)
  }

  override fileUrl(target: FsTarget): string {
    const path = this.processPath(target)
    return `file://${path.split('/').map((part, index) => index === 0 ? '' : encodeURIComponent(part)).join('/')}`
  }

  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const state = await this.ctx.dockerWorkspace.workspace()
    const entries = await super.listDir(target, signal)
    return entries.map(entry => ({ ...entry, target: this.expose(state, entry.target) }))
  }

  private expose(state: DockerSessionWorkspace, target: FsTarget): FsTarget {
    const containerPath = stagingPathToContainer(state.hostWorkspace, String(target.targetKey), state.containerWorkspace)
    if (containerPath === undefined) {
      throw new FsError(`resolved path escaped isolated workspace: ${target.displayPath}`, 'FS_PERMISSION_DENIED')
    }
    const normalized = posix.normalize(containerPath)
    this.processPaths.set(String(target.targetKey), normalized)
    return { targetKey: target.targetKey, displayPath: normalized }
  }
}

export default DockerFileSystem
