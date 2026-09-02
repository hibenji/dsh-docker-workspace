import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { resolveConfig, type DockerWorkspaceConfig } from './config.js'
import { renderDockerPreset } from './preset-template.js'
import { runtimePaths } from './runtime-paths.js'

export const name = 'docker-workspace-preset-installer'
export const inject = ['agentPresets']

export const Config: z<DockerWorkspaceConfig> = z.object({
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
})

const MANAGED_MARKER = '.managed-by-dsh-docker-workspace'

export async function apply(_ctx: Context, config: DockerWorkspaceConfig = {}): Promise<void> {
  const resolved = resolveConfig(config)
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const presetDir = join(dshHome, '.agent-presets', resolved.presetId)
  const marker = join(presetDir, MANAGED_MARKER)

  const existing = await readOptional(marker)
  if (existing === undefined && await pathExists(join(presetDir, 'agent.cordis.yml'))) {
    throw new Error(
      `dsh-docker-workspace: refusing to overwrite existing preset ${JSON.stringify(resolved.presetId)}; `
      + `rename it or choose another presetId`,
    )
  }

  await mkdir(presetDir, { recursive: true })
  const composition = renderDockerPreset(runtimePaths(), resolved)
  const metadata = [
    'name: Docker isolated',
    'description: One private Docker execution workspace per chat; source files are snapshotted and the original project is left untouched.',
    'order: 15',
    '',
  ].join('\n')

  await atomicWrite(join(presetDir, 'agent.cordis.yml'), composition)
  await atomicWrite(join(presetDir, 'preset.yml'), metadata)
  await atomicWrite(marker, '@hibenji/dsh-docker-workspace\n')
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

async function pathExists(path: string): Promise<boolean> {
  return (await readOptional(path)) !== undefined
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export default apply
