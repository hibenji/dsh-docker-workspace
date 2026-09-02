import { spawn } from 'node:child_process'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export class DockerCliError extends Error {
  readonly args: readonly string[]
  readonly result: CommandResult | undefined

  constructor(message: string, args: readonly string[], result?: CommandResult, options?: ErrorOptions) {
    super(message, options)
    this.args = args
    this.result = result
  }
}

export function runCommand(command: string, args: readonly string[], opts: { cwd?: string; signal?: AbortSignal; stdin?: string } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.once('error', reject)
    child.once('close', (code) => {
      resolve({ code: code ?? -1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })
    })
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
  })
}

export async function docker(args: readonly string[], opts: { cwd?: string; signal?: AbortSignal; stdin?: string; allowFailure?: boolean } = {}): Promise<CommandResult> {
  const result = await runCommand('docker', args, opts)
  if (!opts.allowFailure && result.code !== 0) {
    throw new DockerCliError(`docker ${args[0] ?? ''} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`, args, result)
  }
  return result
}

export async function assertDockerAvailable(): Promise<void> {
  try {
    await docker(['version', '--format', '{{.Server.Version}}'])
  } catch (error) {
    throw new DockerCliError('Docker is required for the docker-isolated Harness preset. Start Docker Desktop/Engine and retry.', ['version'], undefined, { cause: error })
  }
}
