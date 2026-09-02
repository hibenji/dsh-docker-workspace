import { resolve } from 'node:path'
import {
  Config,
  DockerWorkspaceRuntime as BaseDockerWorkspaceRuntime,
  type DockerSessionWorkspace,
} from './docker-workspace.js'
import { callingAgent, readyWorkspaceForCallingAgent } from './agent-routing.js'

export { callingAgent } from './agent-routing.js'

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
    // Base runtime intentionally owns the cache; it is a normal TS-private
    // field rather than a JS #private slot, so the adapter can read it while
    // keeping mutation and lifecycle ownership in the base implementation.
    const ready = (this as unknown as { ready: Map<string, DockerSessionWorkspace> }).ready
    return readyWorkspaceForCallingAgent(this.ctx, ready)
  }
}

export default DockerWorkspaceRuntime
