import { fileURLToPath } from 'node:url'
import type { ResolvedDockerWorkspaceConfig } from './config.js'

export interface PresetRuntimePaths {
  dockerWorkspace: string
  dockerFs: string
  dockerSubprocess: string
}

export function runtimePaths(): PresetRuntimePaths {
  return {
    dockerWorkspace: fileURLToPath(new URL('./docker-workspace.js', import.meta.url)),
    dockerFs: fileURLToPath(new URL('./docker-fs.js', import.meta.url)),
    dockerSubprocess: fileURLToPath(new URL('./docker-subprocess.js', import.meta.url)),
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

export function renderDockerPreset(paths: PresetRuntimePaths, config: ResolvedDockerWorkspaceConfig): string {
  return `# Managed by @hibenji/dsh-docker-workspace. Manual edits are overwritten.\n\n`
    + `- id: persona\n`
    + `  name: '@deepseek-ai/dsh-persona'\n`
    + `  config:\n`
    + `    text: >-\n`
    + `      You are a coding agent powered by the {{model}} model. Your source project is {{cwd}}, but your writable execution workspace is an isolated Docker snapshot mounted at ${config.containerWorkspace}. Work only in ${config.containerWorkspace}; the original host project is not modified automatically.\n\n`
    + `- id: docker-execution\n`
    + `  name: cordis:group\n`
    + `  group: true\n`
    + `  isolate:\n`
    + `    dockerWorkspace: true\n`
    + `    fs: true\n`
    + `    subprocess: true\n`
    + `    shell: true\n`
    + `  config:\n`
    + `    - id: docker-workspace\n`
    + `      name: ${yamlString(paths.dockerWorkspace)}\n`
    + `      config:\n`
    + `        image: ${yamlString(config.image)}\n`
    + `        autoBuildImage: ${String(config.autoBuildImage)}\n`
    + `        workspaceRoot: ${yamlString(config.workspaceRoot)}\n`
    + `        containerWorkspace: ${yamlString(config.containerWorkspace)}\n`
    + `        containerPrefix: ${yamlString(config.containerPrefix)}\n`
    + `        network: ${yamlString(config.network)}\n`
    + `        removeContainerOnAgentDispose: ${String(config.removeContainerOnAgentDispose)}\n`
    + `        keepWorkspace: ${String(config.keepWorkspace)}\n`
    + `        copyNodeModules: ${String(config.copyNodeModules)}\n\n`
    + `    - id: fs\n`
    + `      name: ${yamlString(paths.dockerFs)}\n\n`
    + `    - id: subprocess\n`
    + `      name: ${yamlString(paths.dockerSubprocess)}\n\n`
    + `    - id: bash\n`
    + `      name: '@deepseek-ai/dsh-bash-local'\n\n`
    + `    - id: agent-instructions\n`
    + `      name: '@deepseek-ai/dsh-agent-instructions'\n`
    + `      config:\n`
    + `        maxBytes: 65536\n\n`
    + `    - id: tool-bash\n`
    + `      name: '@deepseek-ai/dsh-tool-bash'\n\n`
    + `    - id: tool-fs\n`
    + `      name: '@deepseek-ai/dsh-tool-fs'\n\n`
    + `    - id: tool-fs-search\n`
    + `      name: '@deepseek-ai/dsh-tool-fs-search'\n`
    + `      config:\n`
    + `        sampleOverCapGlobResults: false\n\n`
    + `- id: tool-jobs\n`
    + `  name: '@deepseek-ai/dsh-tool-jobs'\n\n`
    + `- id: skill-filesystem\n`
    + `  name: '@deepseek-ai/dsh-skill-filesystem'\n\n`
    + `- id: tool-skill\n`
    + `  name: '@deepseek-ai/dsh-tool-skill'\n\n`
    + `- id: command-goal\n`
    + `  name: '@deepseek-ai/dsh-command-goal'\n\n`
    + `- id: tool-goal\n`
    + `  name: '@deepseek-ai/dsh-tool-goal'\n\n`
    + `- id: planning\n`
    + `  name: cordis:group\n`
    + `  group: true\n`
    + `  isolate:\n`
    + `    planMode: true\n`
    + `  config:\n`
    + `    - id: plan-mode\n`
    + `      name: '@deepseek-ai/dsh-plan-mode'\n`
    + `      config:\n`
    + `        section: |\n`
    + `              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. Explore first with non-mutating reads and searches. Make the plan decision-complete, then call exit_plan_mode as the only and final tool call of that response.\n\n`
    + `- id: compaction\n`
    + `  name: cordis:group\n`
    + `  group: true\n`
    + `  isolate:\n`
    + `    compaction: true\n`
    + `    toolResultPruner: true\n`
    + `  config:\n`
    + `    - id: compaction-basic\n`
    + `      name: '@deepseek-ai/dsh-compaction-basic'\n`
    + `    - id: command-compact\n`
    + `      name: '@deepseek-ai/dsh-command-compact'\n`
    + `    - id: tool-result-pruner\n`
    + `      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'\n`
    + `      config:\n`
    + `        thresholdChars: 8192\n`
    + `        headChars: 4096\n`
    + `        tailChars: 1024\n\n`
    + `- id: delegation\n`
    + `  name: cordis:group\n`
    + `  group: true\n`
    + `  isolate:\n`
    + `    workflowEngine: true\n`
    + `  config:\n`
    + `    - id: tool-subagent-control\n`
    + `      name: '@deepseek-ai/dsh-tool-subagent-control'\n`
    + `    - id: tool-subagent-list-agents\n`
    + `      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'\n`
    + `    - id: tool-subagent\n`
    + `      name: '@deepseek-ai/dsh-tool-subagent'\n`
    + `      config:\n`
    + `        provider: spawn\n`
    + `        toolName: subagent\n`
    + `        modelSelectionSettings: true\n`
    + `        backgroundMode: continuable\n`
    + `    - id: tool-subagent-fork\n`
    + `      name: '@deepseek-ai/dsh-tool-subagent'\n`
    + `      config:\n`
    + `        provider: fork\n`
    + `        toolName: subagent_fork\n`
    + `        backgroundMode: continuable\n`
    + `    - id: workflow-worker-thread\n`
    + `      name: '@deepseek-ai/dsh-workflow-worker-thread'\n`
    + `      config:\n`
    + `        provider: spawn\n`
    + `    - id: tool-workflow\n`
    + `      name: '@deepseek-ai/dsh-tool-workflow'\n`
    + `    - id: tool-ralph\n`
    + `      name: '@deepseek-ai/dsh-tool-ralph'\n`
    + `      config:\n`
    + `        subagentProvider: spawn\n`
    + `        maxRounds: 64\n\n`
    + `- id: tool-ask-user\n`
    + `  name: '@deepseek-ai/dsh-tool-ask-user'\n\n`
    + `- id: tool-todo\n`
    + `  name: '@deepseek-ai/dsh-tool-todo'\n`
    + `  config:\n`
    + `    allowParallelInProgress: true\n\n`
    + `- id: tool-web\n`
    + `  name: '@deepseek-ai/dsh-tool-web'\n`
    + `  config:\n`
    + `    fetch: true\n`
    + `    searchTimeoutMs: 60000\n`
}
