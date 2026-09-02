import assert from 'node:assert/strict'
import test from 'node:test'
import { mapArgumentForContainer, mapExecutableForContainer } from '../src/execution-paths.ts'

test('host packaged executables map to the container tool while container-resolved paths retain provenance', () => {
  const workspace = (path: string) => path.startsWith('/project/') ? `/workspace/${path.slice('/project/'.length)}` : undefined
  assert.equal(mapExecutableForContainer('/project/bin/tool', workspace, new Set(), () => true), '/workspace/bin/tool')
  assert.equal(mapExecutableForContainer('/host/node_modules/@vscode/ripgrep/bin/rg', workspace, new Set(), () => true), 'rg')
  assert.equal(mapExecutableForContainer('/usr/local/bin/node', workspace, new Set(['/usr/local/bin/node']), () => true), '/usr/local/bin/node')
  assert.equal(mapExecutableForContainer('/container/only/tool', workspace, new Set(), () => false), '/container/only/tool')
})

test('absolute workspace arguments map into the container', () => {
  const workspace = (path: string) => path.startsWith('/project/') ? `/workspace/${path.slice('/project/'.length)}` : undefined
  assert.equal(mapArgumentForContainer('/project/src/a.ts', workspace), '/workspace/src/a.ts')
  assert.equal(mapArgumentForContainer('/tmp/container-file', workspace), '/tmp/container-file')
  assert.equal(mapArgumentForContainer('--flag', workspace), '--flag')
})
