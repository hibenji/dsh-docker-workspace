import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { docker } from '../src/docker-cli.ts'

const smokeEnabled = process.env.DSH_DOCKER_SMOKE === '1'

async function dockerAvailable(): Promise<boolean> {
  if (!smokeEnabled) return false
  try {
    return (await docker(['version', '--format', '{{.Server.Version}}'], { allowFailure: true })).code === 0
  } catch {
    return false
  }
}

test('real Docker mutates only the copied workspace, not the source checkout', async (t) => {
  if (!(await dockerAvailable())) {
    t.skip('set DSH_DOCKER_SMOKE=1 with a working Docker daemon to run this test')
    return
  }

  const root = await mkdtemp(join(tmpdir(), 'dsh-docker-smoke-'))
  const source = join(root, 'source')
  const snapshot = join(root, 'snapshot')
  const dockerfile = fileURLToPath(new URL('../docker/Dockerfile', import.meta.url))
  const image = `dsh-docker-workspace-smoke:${process.pid}`
  const container = `dsh-docker-smoke-${process.pid}-${Date.now()}`.toLowerCase()

  try {
    await mkdir(join(source, 'src'), { recursive: true })
    await writeFile(join(source, 'src', 'value.txt'), 'source\n', 'utf8')
    await cp(source, snapshot, { recursive: true })

    await docker(['build', '-t', image, '-f', dockerfile, dirname(dockerfile)])
    await docker([
      'create',
      '--name', container,
      '--network', 'none',
      '--workdir', '/workspace',
      '--mount', `type=bind,source=${snapshot},target=/workspace`,
      image,
      'sleep', 'infinity',
    ])
    await docker(['start', container])

    await docker([
      'exec', '-w', '/workspace', container,
      'bash', '-lc',
      'printf "container\\n" > src/value.txt; printf "new\\n" > src/new.txt; test "$(pwd)" = /workspace',
    ])

    assert.equal(await readFile(join(source, 'src', 'value.txt'), 'utf8'), 'source\n')
    await assert.rejects(() => readFile(join(source, 'src', 'new.txt'), 'utf8'))
    assert.equal(await readFile(join(snapshot, 'src', 'value.txt'), 'utf8'), 'container\n')
    assert.equal(await readFile(join(snapshot, 'src', 'new.txt'), 'utf8'), 'new\n')

    const mounts = await docker(['inspect', '-f', '{{range .Mounts}}{{.Destination}}|{{end}}', container])
    assert.match(mounts.stdout, /\/workspace\|/)
    assert.doesNotMatch(mounts.stdout, /docker\.sock/)
  } finally {
    await docker(['rm', '-f', container], { allowFailure: true }).catch(() => {})
    await docker(['image', 'rm', '-f', image], { allowFailure: true }).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})
