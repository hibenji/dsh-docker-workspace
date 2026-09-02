import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimePaths } from '../src/runtime-paths.ts'

test('installed preset uses the agent-aware Docker workspace runtime', () => {
  const paths = runtimePaths()
  assert.match(paths.dockerWorkspace.replaceAll('\\', '/'), /\/docker-workspace-agent\.js$/)
  assert.match(paths.dockerFs.replaceAll('\\', '/'), /\/docker-fs\.js$/)
  assert.match(paths.dockerSubprocess.replaceAll('\\', '/'), /\/docker-subprocess\.js$/)
})
