import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DockerSessionWorkspace } from './docker-workspace.js'

/**
 * Return the Agent that owns the current execution.
 *
 * Harness uses `ctx.agents.currentInitiator()` for the asynchronous execution
 * subject. `ctx.agent` is only a static Agent association on an Agent-owned
 * Cordis registration scope, so it is a fallback rather than the primary key.
 */
export function callingAgent(ctx: Pick<Context, 'agents' | 'agent'>): Agent | undefined {
  return ctx.agents.currentInitiator() ?? ctx.agent
}

/** Synchronous lookup used by SubprocessRuntime.spawn(). */
export function readyWorkspaceForCallingAgent(
  ctx: Pick<Context, 'agents' | 'agent'>,
  ready: ReadonlyMap<string, DockerSessionWorkspace>,
): DockerSessionWorkspace | undefined {
  const agent = callingAgent(ctx)
  return agent === undefined ? undefined : ready.get(agent.id)
}
