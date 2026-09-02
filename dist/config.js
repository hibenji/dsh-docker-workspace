import { homedir } from 'node:os';
import { isAbsolute, join, posix, resolve } from 'node:path';
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
const CONTAINER_PREFIX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
export function resolveConfig(config = {}) {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
    const presetId = config.presetId ?? 'docker-isolated';
    const image = (config.image ?? 'dsh-docker-workspace:0.1.0').trim();
    const workspaceRoot = resolve(config.workspaceRoot ?? join(dshHome, 'docker-workspaces'));
    const containerWorkspace = posix.normalize(config.containerWorkspace ?? '/workspace');
    const containerPrefix = config.containerPrefix ?? 'dsh-';
    const network = (config.network ?? 'bridge').trim();
    if (!PRESET_ID.test(presetId)) {
        throw new Error(`dsh-docker-workspace: presetId must match ${String(PRESET_ID)}: ${JSON.stringify(presetId)}`);
    }
    if (image.length === 0)
        throw new Error('dsh-docker-workspace: image must be non-empty');
    if (!isAbsolute(workspaceRoot))
        throw new Error(`dsh-docker-workspace: workspaceRoot must be absolute: ${workspaceRoot}`);
    if (!posix.isAbsolute(containerWorkspace) || containerWorkspace === '/') {
        throw new Error(`dsh-docker-workspace: containerWorkspace must be an absolute Linux path below /: ${JSON.stringify(containerWorkspace)}`);
    }
    if (!CONTAINER_PREFIX.test(containerPrefix)) {
        throw new Error(`dsh-docker-workspace: containerPrefix must match ${String(CONTAINER_PREFIX)}: ${JSON.stringify(containerPrefix)}`);
    }
    if (network.length === 0)
        throw new Error('dsh-docker-workspace: network must be non-empty');
    return {
        presetId,
        image,
        autoBuildImage: config.autoBuildImage ?? true,
        workspaceRoot,
        containerWorkspace,
        containerPrefix,
        network,
        removeContainerOnAgentDispose: config.removeContainerOnAgentDispose ?? true,
        keepWorkspace: config.keepWorkspace ?? true,
        copyNodeModules: config.copyNodeModules ?? false,
    };
}
//# sourceMappingURL=config.js.map