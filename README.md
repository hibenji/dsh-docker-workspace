# DeepSeek Harness Docker Workspace

A DeepSeek Harness bundle that adds a **Docker isolated** agent preset. Every top-level or forked chat using that preset gets its own copied project workspace and its own Linux Docker container, so parallel chats can edit and run code without touching each other or the original checkout. Harness subagent children intentionally share their parent chat's Docker execution world so delegated edits remain visible to the parent.

## What it isolates

- Creates one persistent workspace snapshot per top-level/forked Harness session under `$DSH_HOME/docker-workspaces/`; `origin: subagent` children reuse their parent snapshot and container.
- Copies the selected project into that snapshot on first use. `.git` is preserved.
- Skips `node_modules`, `.venv`, and `venv` by default so Windows/macOS host binaries are not copied into Linux. Set `copyNodeModules: true` if you explicitly want them.
- Bind-mounts only the session snapshot at `/workspace` inside its container.
- Routes Harness Bash, file read/write/edit, glob/grep, and subprocess-backed consumers through the Docker execution world.
- Removes the Docker container when the live Agent is disposed by default, while retaining the snapshot for session resume.
- Never copies changes back to the original project automatically.

The main Harness process, model connection, session log, credentials, approvals, and Web UI stay on the host.

## Requirements

- DeepSeek Harness Developer Preview with agent presets.
- Docker Desktop or Docker Engine available as `docker` on the host PATH.
- Node.js 22+ (the same baseline as current Harness).

## Install

Once this repository is available locally or on GitHub:

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-docker-workspace
```

or from GitHub:

```bash
dsh plugin --profile web add github:hibenji/dsh-docker-workspace
```

Restart/reload the Web profile if requested by Harness. The ordinary new-chat agent-preset picker will then contain **Docker isolated**. No Harness fork is required.

To inspect the composed profile:

```bash
dsh --profile web --dump-config
```

## First run

The first Docker-isolated chat builds `dsh-docker-workspace:0.1.0` automatically if it is missing. The image contains common coding tools: Node 22, npm/corepack, Git, Bash, Python 3, ripgrep, curl, jq, OpenSSH client, and a basic native build toolchain.

A session source such as:

```text
C:\work\my-project
```

is copied to a private host snapshot similar to:

```text
~/.dsh/docker-workspaces/session-.../workspace
```

and mounted in its container as:

```text
/workspace
```

A second chat from the same project gets a different snapshot and container.

## Configuration

Edit the bundle row in the profile's `cordis.patch.yml` to override values:

```yaml
- id: docker-workspace-preset-installer
  config:
    presetId: docker-isolated
    image: dsh-docker-workspace:0.1.0
    autoBuildImage: true
    workspaceRoot: C:/Users/me/.dsh/docker-workspaces
    containerWorkspace: /workspace
    containerPrefix: dsh-
    network: bridge
    removeContainerOnAgentDispose: true
    keepWorkspace: true
    copyNodeModules: false
```

The installer owns the generated preset at `$DSH_HOME/.agent-presets/<presetId>/`. Manual edits to that generated preset are overwritten; change the bundle configuration instead.

## Lifecycle and recovery

The workspace snapshot is the durable copy; the container is disposable. If Harness or Docker stops, reopening the same session recreates/starts its container around the existing snapshot. This means code edits survive normal Agent disposal even though the container is removed.

To delete old snapshots manually, remove their directories under `$DSH_HOME/docker-workspaces/` after you no longer need the corresponding sessions.

## Current boundary

The preset intentionally does not mount Harness's persistent PTY terminal tool. The normal Bash tool, including its background-process mode, is isolated and supported. This avoids pretending `docker exec` provides the same foreground-process-group semantics as a native PTY. A future PTY backend can be added independently without changing the filesystem/process isolation design.

## Security notes

This is isolation for parallel development work, not a hardened hostile-code sandbox. The container receives normal network access (`bridge` by default) and the session snapshot as a writable bind mount. The host Docker socket is **not** mounted and the original source checkout is **not** mounted.

## Development

```bash
npm test
npm run build
```

The repository includes unit tests for path translation/output retention and integration-style tests using a fake Docker CLI. Real Docker smoke tests are also provided and automatically skip when Docker is unavailable.
