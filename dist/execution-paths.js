import { existsSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
/**
 * Translate an executable coordinate at the host/container boundary.
 *
 * Absolute paths are ambiguous on POSIX: `/usr/bin/node` may be a path returned
 * by the container's own executable lookup, while `/opt/app/node_modules/.../rg`
 * may be a packaged helper that exists only on the host. The caller supplies
 * provenance for container-resolved executables and a workspace mapper for
 * project files; existing host executables otherwise fall back to their basename
 * so Docker resolves the corresponding tool on its own PATH.
 */
export function mapExecutableForContainer(command, sourceToContainer, resolvedContainerExecutables, hostPathExists = existsSync) {
    if (!isAbsolute(command))
        return command;
    const workspacePath = sourceToContainer(command);
    if (workspacePath !== undefined)
        return workspacePath;
    if (resolvedContainerExecutables.has(command))
        return command;
    if (hostPathExists(command)) {
        const base = basename(command).replace(/\.exe$/i, '');
        if (/^(rg|ripgrep)(?:[-_.].*)?$/i.test(base))
            return 'rg';
        return base;
    }
    if (command.startsWith('/'))
        return command;
    return basename(command).replace(/\.exe$/i, '');
}
export function mapArgumentForContainer(argument, sourceToContainer) {
    if (!isAbsolute(argument))
        return argument;
    return sourceToContainer(argument) ?? argument;
}
//# sourceMappingURL=execution-paths.js.map