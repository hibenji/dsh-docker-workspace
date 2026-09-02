import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import z from '@deepseek-ai/schemastery';
import { resolveConfig } from './config.js';
import { renderDockerPreset, runtimePaths } from './preset-template.js';
export const name = 'docker-workspace-preset-installer';
export const inject = ['agentPresets'];
export const Config = z.object({
    presetId: z.string(),
    image: z.string(),
    autoBuildImage: z.boolean(),
    workspaceRoot: z.string(),
    containerWorkspace: z.string(),
    containerPrefix: z.string(),
    network: z.string(),
    removeContainerOnAgentDispose: z.boolean(),
    keepWorkspace: z.boolean(),
    copyNodeModules: z.boolean(),
});
const MANAGED_MARKER = '.managed-by-dsh-docker-workspace';
export async function apply(_ctx, config = {}) {
    const resolved = resolveConfig(config);
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
    const presetDir = join(dshHome, '.agent-presets', resolved.presetId);
    const marker = join(presetDir, MANAGED_MARKER);
    const existing = await readOptional(marker);
    if (existing === undefined && await pathExists(join(presetDir, 'agent.cordis.yml'))) {
        throw new Error(`dsh-docker-workspace: refusing to overwrite existing preset ${JSON.stringify(resolved.presetId)}; `
            + `rename it or choose another presetId`);
    }
    await mkdir(presetDir, { recursive: true });
    const composition = renderDockerPreset(runtimePaths(), resolved);
    const metadata = [
        'name: Docker isolated',
        'description: One private Docker execution workspace per chat; source files are snapshotted and the original project is left untouched.',
        'order: 15',
        '',
    ].join('\n');
    await atomicWrite(join(presetDir, 'agent.cordis.yml'), composition);
    await atomicWrite(join(presetDir, 'preset.yml'), metadata);
    await atomicWrite(marker, '@hibenji/dsh-docker-workspace\n');
}
async function atomicWrite(path, content) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
        await writeFile(temp, content, 'utf8');
        await rename(temp, path);
    }
    finally {
        await rm(temp, { force: true }).catch(() => { });
    }
}
async function pathExists(path) {
    return (await readOptional(path)) !== undefined;
}
async function readOptional(path) {
    try {
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
export default apply;
//# sourceMappingURL=install-preset.js.map