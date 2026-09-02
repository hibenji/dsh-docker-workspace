import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { posix } from 'node:path';
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import { docker } from './docker-cli.js';
import { TailOutputReader } from './output.js';
import { mapArgumentForContainer, mapExecutableForContainer } from './execution-paths.js';
export const name = 'docker-subprocess';
export const inject = ['dockerWorkspace'];
const MAX_TIMER_DELAY_MS = 2_147_483_647;
class SpillCapture {
    hostPath;
    containerPath;
    maxBytes;
    fd;
    bytes = 0;
    intact = true;
    constructor(hostPath, containerPath, maxBytes) {
        this.hostPath = hostPath;
        this.containerPath = containerPath;
        this.maxBytes = maxBytes;
        mkdirSync(dirname(hostPath), { recursive: true });
        this.fd = openSync(hostPath, 'w', 0o600);
    }
    append(chunk) {
        if (!this.intact || this.fd === undefined)
            return;
        this.bytes += chunk.length;
        if (this.bytes > this.maxBytes) {
            this.intact = false;
            closeSync(this.fd);
            this.fd = undefined;
            try {
                unlinkSync(this.hostPath);
            }
            catch { }
            return;
        }
        writeSync(this.fd, chunk);
    }
    close() {
        if (this.fd !== undefined) {
            closeSync(this.fd);
            this.fd = undefined;
        }
    }
    path() {
        return this.intact ? this.containerPath : undefined;
    }
}
class DockerProcessHandle {
    state;
    pidFile;
    graceMs;
    pid;
    stdin;
    stdout;
    stderr;
    collected;
    done;
    child;
    terminatedBy = null;
    terminating = false;
    closed = false;
    constructor(child, state, pidFile, graceMs, stdoutCollector, stderrCollector, signal) {
        this.state = state;
        this.pidFile = pidFile;
        this.graceMs = graceMs;
        this.child = child;
        this.pid = child.pid ?? -1;
        this.stdin = child.stdin ?? undefined;
        this.stdout = stdoutCollector === undefined ? child.stdout ?? undefined : undefined;
        this.stderr = stderrCollector === undefined ? child.stderr ?? undefined : undefined;
        this.collected = {
            ...(stdoutCollector === undefined ? {} : { stdout: stdoutCollector.reader }),
            ...(stderrCollector === undefined ? {} : { stderr: stderrCollector.reader }),
        };
        if (stdoutCollector !== undefined)
            child.stdout?.on('data', chunk => {
                const data = Buffer.from(chunk);
                stdoutCollector.reader.append(data);
                stdoutCollector.spill?.append(data);
            });
        if (stderrCollector !== undefined)
            child.stderr?.on('data', chunk => {
                const data = Buffer.from(chunk);
                stderrCollector.reader.append(data);
                stderrCollector.spill?.append(data);
            });
        this.done = new Promise((resolveDone, reject) => {
            child.once('error', reject);
            child.once('close', (code, childSignal) => {
                this.closed = true;
                stdoutCollector?.spill?.close();
                stderrCollector?.spill?.close();
                const syntheticSignal = childSignal ?? this.terminatedBy;
                resolveDone({
                    exitCode: syntheticSignal === null ? (code ?? null) : null,
                    signal: syntheticSignal,
                });
            });
        });
        if (signal !== undefined) {
            if (signal.aborted)
                this.terminate();
            else
                signal.addEventListener('abort', () => this.terminate(), { once: true });
        }
    }
    terminate() {
        if (this.terminating || this.closed)
            return;
        this.terminating = true;
        this.terminatedBy = 'SIGTERM';
        void remoteSignal(this.state.containerName, this.pidFile, 'TERM').catch(() => { });
        setTimeout(() => {
            if (this.closed)
                return;
            this.terminatedBy = 'SIGKILL';
            void remoteSignal(this.state.containerName, this.pidFile, 'KILL').catch(() => { });
            try {
                this.child.kill('SIGKILL');
            }
            catch { }
        }, this.graceMs).unref();
    }
    async waitForExit(signal) {
        for (;;) {
            if (signal?.aborted)
                return false;
            const alive = await remoteGroupAlive(this.state.containerName, this.pidFile).catch(() => false);
            if (!alive && this.closed)
                return true;
            await delay(80, signal);
            if (signal?.aborted)
                return false;
        }
    }
}
export class DockerSubprocessRuntime extends SubprocessRuntime {
    static inject = ['dockerWorkspace'];
    live = new Set();
    resolvedContainerExecutables = new Set();
    constructor(ctx) {
        super(ctx);
        ctx.effect(() => async () => {
            for (const handle of this.live)
                handle.terminate();
            await Promise.allSettled([...this.live].map(async (handle) => {
                await handle.done.catch(() => { });
                await handle.waitForExit();
            }));
            this.live.clear();
        }, 'docker subprocess teardown');
    }
    async resolveExecutable(command, env, signal) {
        if (command.length === 0)
            throw new Error('docker-subprocess: executable must be non-empty');
        signal?.throwIfAborted();
        const state = await this.ctx.dockerWorkspace.workspace();
        const mapped = this.mapExecutable(state, command);
        if (!isContainerAbsolute(mapped) && mapped.includes('/')) {
            throw new Error(`docker-subprocess: command ${JSON.stringify(command)} is a relative path; use an absolute path or bare PATH name`);
        }
        const envArgs = Object.entries(env ?? {}).flatMap(([key, value]) => value === undefined ? ['-u', key] : [`${key}=${value}`]);
        const script = isContainerAbsolute(mapped)
            ? 'test -f "$1" && test -x "$1" && printf "%s\\n" "$1"'
            : 'command -v -- "$1"';
        const result = await docker([
            'exec', state.containerName,
            'env', ...envArgs,
            'sh', '-c', script, 'dsh-resolve', mapped,
        ], { allowFailure: true, signal });
        if (result.code !== 0 || result.stdout.trim() === '') {
            throw new Error(`docker-subprocess: command ${JSON.stringify(command)} was not found in container ${state.containerName}`);
        }
        const executable = result.stdout.trim().split(/\r?\n/)[0];
        this.resolvedContainerExecutables.add(executable);
        return executable;
    }
    spawn(spec) {
        spec.signal?.throwIfAborted();
        if (!Number.isFinite(spec.graceMs) || spec.graceMs <= 0 || spec.graceMs > MAX_TIMER_DELAY_MS) {
            throw new Error(`docker-subprocess: graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
        }
        const state = this.ctx.dockerWorkspace.peekWorkspace();
        if (state === undefined) {
            throw new Error('docker-subprocess: workspace is not initialized; resolve a file or execute through an Agent-scoped call first');
        }
        const [program, ...rest] = spec.argv;
        if (program === undefined || program.length === 0)
            throw new Error('docker-subprocess: argv must contain a program');
        const cwd = this.mapCwd(state, spec.cwd);
        const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const pidFile = `/tmp/dsh-process/${token}.pid`;
        const mappedProgram = this.mapExecutable(state, program);
        const mappedArgs = rest.map(arg => this.mapArgument(state, arg));
        const environment = Object.entries(spec.env ?? {});
        const envCommand = ['env'];
        for (const [key, value] of environment) {
            if (value === undefined)
                envCommand.push('-u', key);
            else
                envCommand.push(`${key}=${value}`);
        }
        const stdoutCollector = collectState(spec.stdio.stdout, state, token, 'stdout');
        const stderrCollector = collectState(spec.stdio.stderr, state, token, 'stderr');
        const stdoutMode = nodeOutputMode(spec.stdio.stdout);
        const stderrMode = nodeOutputMode(spec.stdio.stderr);
        const needsInput = spec.stdio.stdin !== 'ignore';
        const dockerArgs = [
            'exec',
            ...needsInput ? ['-i'] : [],
            '-w', cwd,
            state.containerName,
            'sh', '/opt/dsh-docker/process-wrapper.sh', pidFile,
            ...envCommand,
            mappedProgram,
            ...mappedArgs,
        ];
        const child = spawn('docker', dockerArgs, {
            windowsHide: true,
            stdio: [needsInput ? 'pipe' : 'ignore', stdoutMode, stderrMode],
        });
        const handle = new DockerProcessHandle(child, state, pidFile, spec.graceMs, stdoutCollector, stderrCollector, spec.signal);
        this.live.add(handle);
        const release = async () => {
            await handle.waitForExit().catch(() => { });
            this.live.delete(handle);
        };
        void handle.done.then(release, release).catch(() => {
        });
        if (typeof spec.stdio.stdin === 'object')
            child.stdin?.end(spec.stdio.stdin.data);
        return handle;
    }
    async spawnTerminal(_spec) {
        throw new Error('docker-subprocess: terminal PTY allocation is not exposed by the docker-isolated preset; use the persistent Bash tool instead');
    }
    mapCwd(state, cwd) {
        if (cwd === state.containerWorkspace || cwd.startsWith(`${state.containerWorkspace}/`))
            return posix.normalize(cwd);
        const mapped = this.ctx.dockerWorkspace.sourceToContainer(state, resolve(cwd));
        if (mapped === undefined)
            throw new Error(`docker-subprocess: cwd is outside isolated workspace: ${cwd}`);
        return mapped;
    }
    mapExecutable(state, command) {
        return mapExecutableForContainer(command, path => this.ctx.dockerWorkspace.sourceToContainer(state, path), this.resolvedContainerExecutables);
    }
    mapArgument(state, arg) {
        return mapArgumentForContainer(arg, path => this.ctx.dockerWorkspace.sourceToContainer(state, path));
    }
}
function isContainerAbsolute(path) {
    return path.startsWith('/');
}
function nodeOutputMode(mode) {
    return mode === 'inherit' ? 'inherit' : 'pipe';
}
function collectState(mode, state, token, stream) {
    if (typeof mode === 'string')
        return undefined;
    const spill = createSpill(mode, state, token, stream);
    const reader = new TailOutputReader(mode.maxBytes, () => spill?.path());
    return { reader, ...(spill === undefined ? {} : { spill }) };
}
function createSpill(mode, state, token, stream) {
    if (mode.spill === undefined)
        return undefined;
    const dir = join(state.hostWorkspace, '.dsh-spill');
    const filename = `${token}-${stream}.log`;
    return new SpillCapture(join(dir, filename), posix.join(state.containerWorkspace, '.dsh-spill', filename), mode.spill.maxBytes);
}
async function remoteSignal(container, pidFile, signal) {
    const script = [
        'p=$(cat "$1" 2>/dev/null || true)',
        '[ -z "$p" ] && exit 0',
        `kill -${signal} -- "-$p" 2>/dev/null || kill -${signal} "$p" 2>/dev/null || true`,
    ].join('; ');
    await docker(['exec', container, 'sh', '-c', script, 'dsh-signal', pidFile], { allowFailure: true });
}
async function remoteGroupAlive(container, pidFile) {
    const script = 'p=$(cat "$1" 2>/dev/null || true); [ -n "$p" ] && kill -0 -- "-$p" 2>/dev/null';
    const result = await docker(['exec', container, 'sh', '-c', script, 'dsh-alive', pidFile], { allowFailure: true });
    return result.code === 0;
}
function delay(ms, signal) {
    return new Promise(resolveDelay => {
        const timer = setTimeout(resolveDelay, ms);
        if (signal !== undefined)
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                resolveDelay();
            }, { once: true });
    });
}
export default DockerSubprocessRuntime;
//# sourceMappingURL=docker-subprocess.js.map
