import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConfig } from '../src/config.ts'
import { renderDockerPreset } from '../src/preset-template.ts'

test('generated preset isolates the execution seams and retains standard coding tools', () => {
  const config = resolveConfig({
    image: 'example/test:1',
    workspaceRoot: '/tmp/workspaces',
    network: 'none',
    containerWorkspace: '/code',
  })
  const rendered = renderDockerPreset({
    dockerWorkspace: '/plugin/docker-workspace.js',
    dockerFs: '/plugin/docker-fs.js',
    dockerSubprocess: '/plugin/docker-subprocess.js',
  }, config)

  for (const service of ['dockerWorkspace: true', 'fs: true', 'subprocess: true', 'shell: true']) {
    assert.match(rendered, new RegExp(service))
  }
  for (const row of [
    '@deepseek-ai/dsh-bash-local',
    '@deepseek-ai/dsh-tool-bash',
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-agent-instructions',
    '@deepseek-ai/dsh-skill-filesystem',
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-workflow',
    '@deepseek-ai/dsh-tool-web',
  ]) {
    assert.match(rendered, new RegExp(row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(rendered, /image: "example\/test:1"/)
  assert.match(rendered, /network: "none"/)
  assert.match(rendered, /containerWorkspace: "\/code"/)
  assert.match(rendered, /isolated Docker snapshot mounted at \/code/)
  assert.match(rendered, /Work only in \/code/)
  assert.match(rendered, /original host project is not modified automatically/)
})
