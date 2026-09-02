import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  Config,
  DockerWorkspaceRuntime as BaseDockerWorkspaceRuntime,
  type DockerSessionWorkspace,
} from './docker-workspace.js'

/**
 * Resolve the Agent that owns the current execution.
 *
 * `ctx.agent` is a static registration-scope association. Tool execution is
 * driven through Harness's process-local initiator scope instead, so shared
 * infrastructure must read `ctx.agents.currentInitiator()` to distinguish
 * concurrent top-level agents and subagents correctly.
 *
 * The static association remains a fallback for direct calls made from an
 * Agent-owned Cordis scope (for example tests or setup helpers outside a loop
 * driver boundary).
 */
export function callingAgent(ctx: Pick<Context, 'agents' | 'agent'>): Agent | undefined {
  return ctx.agents.currentInitiator() ?? ctx.agent
}

/** Agent-aware Docker workspace service used by the installed preset. */
export class DockerWorkspaceRuntime extends BaseDockerWorkspaceRuntime {
  static inject = ['agents']
  static Config = Config

  override currentIdentity(): { sessionId: string; sourceRoot: string; parentSession?: string; origin?: string } {
    const agent = callingAgent(this.ctx)
    if (agent === undefined) {
      throw new Error('docker-workspace: operation has no initiating Agent; the Docker execution world is session-scoped')
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

  override peekWorkspace(): DockerSessionWorkspace | undefined {
    const agent = callingAgent(this.ctx)
    if (agent === undefined) return undefined
    // Base runtime intentionally owns the cache; it is a normal TS-private
    // field rather than a JS #private slot, so the adapter can read it while
    // keeping mutation and lifecycle ownership in the base implementation.
    const ready = (this as unknown as { ready: Map<string, DockerSessionWorkspace> }).ready
    return ready.get(agent.id)
  }
}

export default DockerWorkspaceRuntime
