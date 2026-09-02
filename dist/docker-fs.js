import { posix } from 'node:path';
import { FsError } from '@deepseek-ai/dsh-fs';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { stagingPathToContainer, translateInputPath } from './paths.js';
export const name = 'docker-fs';
export const inject = ['dockerWorkspace'];
export class DockerFileSystem extends LocalFileSystem {
    static inject = ['dockerWorkspace'];
    processPaths = new Map();
    constructor(ctx) {
        super(ctx, { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 });
    }
    async resolve(path, opts) {
        const state = await this.ctx.dockerWorkspace.workspace();
        let hostPath;
        try {
            hostPath = translateInputPath(path, opts?.cwd, state.sourceRoot, state.hostWorkspace, state.containerWorkspace);
        }
        catch (error) {
            throw new FsError(error instanceof Error ? error.message : String(error), 'FS_PERMISSION_DENIED', { cause: error });
        }
        const local = await super.resolve(hostPath, { signal: opts?.signal });
        return this.expose(state, local);
    }
    async lstat(path, opts, signal) {
        const state = await this.ctx.dockerWorkspace.workspace();
        let hostPath;
        try {
            hostPath = translateInputPath(path, opts?.cwd, state.sourceRoot, state.hostWorkspace, state.containerWorkspace);
        }
        catch (error) {
            throw new FsError(error instanceof Error ? error.message : String(error), 'FS_PERMISSION_DENIED', { cause: error });
        }
        return super.lstat(hostPath, undefined, signal);
    }
    processPath(target) {
        const cached = this.processPaths.get(String(target.targetKey));
        if (cached !== undefined)
            return cached;
        if (target.displayPath.startsWith('/'))
            return target.displayPath;
        throw new Error(`docker-fs: unknown target ${String(target.targetKey)}; resolve it through this provider before using processPath()`);
    }
    contains(parent, child) {
        const rel = posix.relative(this.processPath(parent), this.processPath(child));
        return rel === '' || (rel !== '..' && !rel.startsWith('../') && !posix.isAbsolute(rel));
    }
    processPathFromHostPath(hostPath) {
        const state = this.ctx.dockerWorkspace.peekWorkspace();
        if (state === undefined)
            return undefined;
        return this.ctx.dockerWorkspace.sourceToContainer(state, hostPath);
    }
    fileUrl(target) {
        const path = this.processPath(target);
        return `file://${path.split('/').map((part, index) => index === 0 ? '' : encodeURIComponent(part)).join('/')}`;
    }
    async listDir(target, signal) {
        const state = await this.ctx.dockerWorkspace.workspace();
        const entries = await super.listDir(target, signal);
        return entries.map(entry => ({ ...entry, target: this.expose(state, entry.target) }));
    }
    expose(state, target) {
        const containerPath = stagingPathToContainer(state.hostWorkspace, String(target.targetKey), state.containerWorkspace);
        if (containerPath === undefined) {
            throw new FsError(`resolved path escaped isolated workspace: ${target.displayPath}`, 'FS_PERMISSION_DENIED');
        }
        const normalized = posix.normalize(containerPath);
        this.processPaths.set(String(target.targetKey), normalized);
        return { targetKey: target.targetKey, displayPath: normalized };
    }
}
export default DockerFileSystem;
//# sourceMappingURL=docker-fs.js.map