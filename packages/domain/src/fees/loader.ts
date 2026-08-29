import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRulePack } from './schema.ts'
import type { JurisdictionRulePack } from './types.ts'

/**
 * The default pack directory, resolved relative to this package rather
 * than to process.cwd(), so a server started from any directory finds it.
 * packages/domain/src/fees -> ../../../../config/jurisdictions
 */
export const DEFAULT_JURISDICTIONS_DIR = fileURLToPath(
  new URL('../../../../config/jurisdictions', import.meta.url),
)

export class PackRegistryError extends Error {
  constructor(detail: string) {
    super(`Jurisdiction pack registry: ${detail}`)
    this.name = 'PackRegistryError'
  }
}

export interface PackRegistry {
  get(id: string): JurisdictionRulePack
  has(id: string): boolean
  ids(): readonly string[]
  all(): readonly JurisdictionRulePack[]
}

export function loadPackFromFile(absolutePath: string): JurisdictionRulePack {
  const label = basename(absolutePath)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(absolutePath, 'utf8'))
  } catch (cause) {
    throw new PackRegistryError(
      `could not read or parse "${label}": ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  // parseRulePack throws InvalidRulePackError, which already names the file.
  return parseRulePack(raw, label)
}

/**
 * Load every pack in a directory, or throw.
 *
 * Throws on the FIRST problem rather than collecting them. FR-10 and GW-4
 * both require failing the boot: a service that starts with a missing
 * jurisdiction turns an operator's deployment failure into a citizen's 404.
 */
export function loadPackRegistry(directory: string): PackRegistry {
  let entries: string[]
  try {
    if (!statSync(directory).isDirectory()) {
      throw new PackRegistryError(`"${directory}" is not a directory`)
    }
    entries = readdirSync(directory)
  } catch (cause) {
    if (cause instanceof PackRegistryError) throw cause
    throw new PackRegistryError(
      `could not read directory "${directory}": ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  const byId = new Map<string, JurisdictionRulePack>()
  const sourceById = new Map<string, string>()

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue
    const pack = loadPackFromFile(join(directory, entry))
    const existing = sourceById.get(pack.id)
    if (existing !== undefined) {
      throw new PackRegistryError(
        `two packs claim id "${pack.id}": "${existing}" and "${entry}". ` +
          'Exactly one version of a jurisdiction may be loaded at a time.',
      )
    }
    byId.set(pack.id, pack)
    sourceById.set(pack.id, entry)
  }

  if (byId.size === 0) {
    throw new PackRegistryError(
      `no jurisdiction packs found in "${directory}". The service cannot start without at least one.`,
    )
  }

  const sortedIds = [...byId.keys()].sort()
  const sortedPacks = sortedIds.map((id) => byId.get(id) as JurisdictionRulePack)

  return {
    get(id: string): JurisdictionRulePack {
      const pack = byId.get(id)
      if (pack === undefined) {
        throw new PackRegistryError(
          `unknown jurisdiction "${id}". Loaded jurisdictions: ${sortedIds.join(', ')}`,
        )
      }
      return pack
    },
    has: (id: string) => byId.has(id),
    ids: () => sortedIds,
    all: () => sortedPacks,
  }
}
