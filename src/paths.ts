import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { posix } from 'node:path'

export function safeSessionSlug(sessionId: string): string {
  const readable = sessionId.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'session'
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 10)
  return `${readable}-${hash}`
}

export function isInsideHost(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function sourcePathToContainer(sourceRoot: string, sourcePath: string, containerRoot = '/workspace'): string | undefined {
  const absolute = resolve(sourcePath)
  if (!isInsideHost(sourceRoot, absolute)) return undefined
  const rel = relative(resolve(sourceRoot), absolute).split(sep).join('/')
  return rel === '' ? containerRoot : posix.join(containerRoot, rel)
}

export function stagingPathToContainer(stagingRoot: string, stagingPath: string, containerRoot = '/workspace'): string | undefined {
  const absolute = resolve(stagingPath)
  if (!isInsideHost(stagingRoot, absolute)) return undefined
  const rel = relative(resolve(stagingRoot), absolute).split(sep).join('/')
  return rel === '' ? containerRoot : posix.join(containerRoot, rel)
}

export function containerPathToStaging(stagingRoot: string, containerPath: string, containerRoot = '/workspace'): string | undefined {
  const normalizedRoot = posix.resolve(containerRoot)
  const normalized = posix.resolve(containerPath)
  const rel = posix.relative(normalizedRoot, normalized)
  if (rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel)) return undefined
  return resolve(stagingRoot, ...rel.split('/').filter(Boolean))
}

export function translateInputPath(
  input: string,
  cwd: string | undefined,
  sourceRoot: string,
  stagingRoot: string,
  containerRoot = '/workspace',
): string {
  if (posix.isAbsolute(input) && (input === containerRoot || input.startsWith(`${containerRoot}/`))) {
    const mapped = containerPathToStaging(stagingRoot, input, containerRoot)
    if (mapped === undefined) throw new Error(`path escapes container workspace: ${input}`)
    return mapped
  }
  const base = cwd ?? sourceRoot
  if (posix.isAbsolute(base) && (base === containerRoot || base.startsWith(`${containerRoot}/`))) {
    const mappedBase = containerPathToStaging(stagingRoot, base, containerRoot)
    if (mappedBase === undefined) throw new Error(`cwd escapes container workspace: ${base}`)
    return resolve(mappedBase, input)
  }
  const hostAbsolute = isAbsolute(input) ? resolve(input) : resolve(base, input)
  if (isInsideHost(stagingRoot, hostAbsolute)) return hostAbsolute
  if (isInsideHost(sourceRoot, hostAbsolute)) {
    const rel = relative(resolve(sourceRoot), hostAbsolute)
    return resolve(stagingRoot, rel)
  }
  throw new Error(`path is outside the isolated project workspace: ${input}`)
}
