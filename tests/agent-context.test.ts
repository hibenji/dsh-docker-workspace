import assert from 'node:assert/strict'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DockerSessionWorkspace } from '../src/docker-workspace.ts'
import { callingAgent, readyWorkspaceForCallingAgent } from '../src/agent-routing.ts'

function fakeAgent(id: string, cwd: string): Agent {
  return {
    id,
    session: {
      header: { cwd },
    },
  } as unknown as Agent
}

test('callingAgent prefers the Harness initiator over a static ctx.agent association', () => {
  const initiator = fakeAgent('initiator', '/project/initiator')
  const staticAgent = fakeAgent('static', '/project/static')
  const ctx = {
    agents: { currentInitiator: () => initiator },
    agent: staticAgent,
  } as never

  assert.equal(callingAgent(ctx), initiator)
})

test('callingAgent falls back to an Agent-owned Cordis scope for direct calls', () => {
  const staticAgent = fakeAgent('static', '/project/static')
  const ctx = {
    agents: { currentInitiator: () => undefined },
    agent: staticAgent,
  } as never

  assert.equal(callingAgent(ctx), staticAgent)
})

test('synchronous workspace lookup routes by the initiating Agent', () => {
  const initiator = fakeAgent('session-a', '/project/a')
  const staticAgent = fakeAgent('session-b', '/project/b')
  const state = {
    sessionId: 'session-a',
    sourceRoot: '/project/a',
    sessionRoot: '/staging/session-a',
    hostWorkspace: '/staging/session-a/workspace',
    containerWorkspace: '/workspace',
    containerName: 'dsh-session-a',
    helperPath: '/staging/session-a/runtime/process-wrapper.sh',
  } satisfies DockerSessionWorkspace
  const ctx = {
    agents: { currentInitiator: () => initiator },
    agent: staticAgent,
  } as never

  assert.equal(readyWorkspaceForCallingAgent(ctx, new Map([[initiator.id, state]])), state)
})
