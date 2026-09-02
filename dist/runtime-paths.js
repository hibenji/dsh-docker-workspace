import { fileURLToPath } from 'node:url';
/** Runtime entry points installed into the Docker-isolated agent preset. */
export function runtimePaths() {
    return {
        dockerWorkspace: fileURLToPath(new URL('./docker-workspace-agent.js', import.meta.url)),
        dockerFs: fileURLToPath(new URL('./docker-fs.js', import.meta.url)),
        dockerSubprocess: fileURLToPath(new URL('./docker-subprocess.js', import.meta.url)),
    };
}
//# sourceMappingURL=runtime-paths.js.map