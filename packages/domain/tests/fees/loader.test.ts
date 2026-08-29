import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidRulePackError } from '../../src/fees/schema.ts'
import { PackRegistryError, loadPackRegistry } from '../../src/fees/loader.ts'

let directory: string

const validPack = (id: string, currency = 'GBP') => ({
  id,
  jurisdictionLabel: `Label ${id}`,
  currency,
  version: '2026.1',
  timezone: 'Europe/London',
  provenance: 'SYNTHETIC',
  basisStrategy: 'CONSIDERATION_ONLY',
  requiredAttributes: [],
  components: [{ code: 'FEE', label: 'Fee', kind: 'FLAT', amountMinor: '1' }],
})

function write(filename: string, contents: unknown): void {
  writeFileSync(
    join(directory, filename),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
    'utf8',
  )
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'packs-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('loadPackRegistry', () => {
  it('loads every JSON pack in the directory', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    write('JP-2026.1.json', validPack('JP', 'JPY'))

    const registry = loadPackRegistry(directory)
    expect([...registry.ids()].sort()).toEqual(['GB-ENG', 'JP'])
    expect(registry.get('JP').currency).toBe('JPY')
    expect(registry.has('GB-ENG')).toBe(true)
    expect(registry.has('AE-DU')).toBe(false)
  })

  it('returns packs sorted by id, so listings are stable', () => {
    write('JP-2026.1.json', validPack('JP', 'JPY'))
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    expect(
      loadPackRegistry(directory)
        .all()
        .map((p) => p.id),
    ).toEqual(['GB-ENG', 'JP'])
  })

  it('ignores non-JSON files', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    write('README.md', '# not a pack')
    expect(loadPackRegistry(directory).ids()).toHaveLength(1)
  })

  it('FAILS THE BOOT on an invalid pack rather than skipping it', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    write('BAD-2026.1.json', { id: 'BAD' })
    expect(() => loadPackRegistry(directory)).toThrow(InvalidRulePackError)
  })

  it('fails the boot on an unmarked provenance', () => {
    const { provenance: _omitted, ...unmarked } = validPack('GB-ENG')
    write('GB-ENG-2026.1.json', unmarked)
    expect(() => loadPackRegistry(directory)).toThrow(InvalidRulePackError)
  })

  it('names the offending file in the error', () => {
    write('BAD-2026.1.json', { id: 'BAD' })
    expect(() => loadPackRegistry(directory)).toThrow(/BAD-2026\.1\.json/)
  })

  it('fails on malformed JSON, naming the file', () => {
    write('BROKEN-2026.1.json', '{ not json')
    expect(() => loadPackRegistry(directory)).toThrow(/BROKEN-2026\.1\.json/)
  })

  it('rejects two packs claiming the same id', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    write('GB-ENG-2026.2.json', { ...validPack('GB-ENG'), version: '2026.2' })
    expect(() => loadPackRegistry(directory)).toThrow(PackRegistryError)
    expect(() => loadPackRegistry(directory)).toThrow(/GB-ENG/)
  })

  it('rejects an empty directory, because a service with no jurisdictions is useless', () => {
    expect(() => loadPackRegistry(directory)).toThrow(PackRegistryError)
  })

  it('rejects a missing directory', () => {
    expect(() => loadPackRegistry(join(directory, 'nope'))).toThrow(PackRegistryError)
  })

  it('throws a legible error for an unknown id at get time', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    const registry = loadPackRegistry(directory)
    expect(() => registry.get('XX')).toThrow(PackRegistryError)
    expect(() => registry.get('XX')).toThrow(/GB-ENG/) // lists what IS available
  })
})
