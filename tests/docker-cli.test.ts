import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { docker, DockerCliError, runCommand } from '../src/docker-cli.ts'

test('command runner captures stdout, stderr, stdin, and exit status', async () => {
  const result = await runCommand(process.execPath, ['-e', `process.stdin.on('data', d => process.stdout.write(d)); console.error('err'); process.stdin.on('end', () => process.exit(7))`], { stdin: 'hello' })
  assert.equal(result.code, 7)
  assert.equal(result.stdout, 'hello')
  assert.match(result.stderr, /err/)
})

test('docker wrapper reports a failing docker invocation', async (t) => {
  if (process.platform === 'win32') {
    t.skip('fake executable fixture is POSIX-only; Windows is covered by CI syntax/type checks')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'fake-docker-'))
  const executable = join(dir, 'docker')
  await writeFile(executable, '#!/bin/sh\necho fake-error >&2\nexit 23\n')
  await chmod(executable, 0o755)
  const oldPath = process.env.PATH
  process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`
  try {
    await assert.rejects(() => docker(['version']), (error: unknown) => {
      assert.ok(error instanceof DockerCliError)
      assert.match(error.message, /fake-error/)
      return true
    })
  } finally {
    process.env.PATH = oldPath
  }
})
