import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { resolveConfig } from '../src/config.ts'
import {
  containerPathToStaging,
  isInsideHost,
  safeSessionSlug,
  sourcePathToContainer,
  stagingPathToContainer,
  translateInputPath,
} from '../src/paths.ts'

test('session slugs are deterministic, readable, and collision-resistant by suffix', () => {
  const first = safeSessionSlug('session-ABC / weird')
  const second = safeSessionSlug('session-ABC / weird')
  const other = safeSessionSlug('session-ABC / weird!')
  assert.equal(first, second)
  assert.notEqual(first, other)
  assert.match(first, /^session-abc-weird-[a-f0-9]{10}$/)
})

test('source and staging paths map to the same container root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paths-'))
  const source = join(root, 'source')
  const staging = join(root, 'staging')
  await mkdir(join(source, 'src'), { recursive: true })
  await mkdir(join(staging, 'src'), { recursive: true })

  assert.equal(sourcePathToContainer(source, join(source, 'src', 'a.ts')), '/workspace/src/a.ts')
  assert.equal(stagingPathToContainer(staging, join(staging, 'src', 'a.ts')), '/workspace/src/a.ts')
  assert.equal(containerPathToStaging(staging, '/workspace/src/a.ts'), resolve(staging, 'src', 'a.ts'))
  assert.equal(sourcePathToContainer(source, root), undefined)
  assert.equal(containerPathToStaging(staging, '/etc/passwd'), undefined)
})

test('input translation accepts source/container coordinates but rejects outside paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-translate-'))
  const source = join(root, 'source')
  const staging = join(root, 'staging')
  await mkdir(join(source, 'src'), { recursive: true })
  await mkdir(join(staging, 'src'), { recursive: true })

  assert.equal(
    translateInputPath('src/a.ts', source, source, staging),
    resolve(staging, 'src', 'a.ts'),
  )
  assert.equal(
    translateInputPath('/workspace/src/a.ts', '/workspace', source, staging),
    resolve(staging, 'src', 'a.ts'),
  )
  assert.equal(
    translateInputPath(join(source, 'src', 'a.ts'), undefined, source, staging),
    resolve(staging, 'src', 'a.ts'),
  )
  assert.throws(
    () => translateInputPath('../outside.txt', source, source, staging),
    /outside the isolated project workspace/,
  )
  assert.equal(isInsideHost(source, join(source, 'src')), true)
  assert.equal(isInsideHost(source, root), false)
})


test('configuration rejects preset traversal and invalid container roots', () => {
  assert.throws(() => resolveConfig({ presetId: '../escape' }), /presetId must match/)
  assert.throws(() => resolveConfig({ containerWorkspace: '/' }), /absolute Linux path below \//)
  assert.throws(() => resolveConfig({ containerWorkspace: 'relative' }), /absolute Linux path below \//)
  assert.throws(() => resolveConfig({ containerPrefix: 'bad prefix' }), /containerPrefix must match/)
  assert.equal(resolveConfig({ containerWorkspace: '/code/../workspace' }).containerWorkspace, '/workspace')
})
