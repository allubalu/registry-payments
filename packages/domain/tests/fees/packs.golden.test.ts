import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/index.ts'
import { computeFee } from '../../src/fees/compute.ts'
import { loadPackRegistry } from '../../src/fees/loader.ts'
import type { AttributeValue, PropertyType, TransactionType } from '../../src/fees/types.ts'

const configRoot = fileURLToPath(new URL('../../../../config/', import.meta.url))
const jurisdictionsDir = join(configRoot, 'jurisdictions')
const fixturesDir = join(configRoot, 'fixtures')

interface GoldenCase {
  readonly name: string
  readonly input: {
    readonly propertyType: PropertyType
    readonly transactionType: TransactionType
    readonly considerationMinor: string
    readonly marketValueMinor: string
    readonly attributes: Record<string, AttributeValue>
  }
  readonly expected: {
    readonly chargeableValueMinor: string
    readonly components: Record<string, string>
    readonly notApplied: readonly string[]
    readonly totalMinor: string
  }
}

interface GoldenFixtureFile {
  readonly packId: string
  readonly cases: readonly GoldenCase[]
}

const registry = loadPackRegistry(jurisdictionsDir)

describe('every jurisdiction pack', () => {
  it('loads at least one pack, so a broken path cannot pass vacuously', () => {
    expect(registry.ids().length).toBeGreaterThan(0)
  })

  it('has a fixture file for EVERY pack — a pack without fixtures fails CI (FR-9)', () => {
    const missing = registry
      .ids()
      .filter((id) => !existsSync(join(fixturesDir, `${id}.golden.json`)))
    expect(missing).toEqual([])
  })

  it('has no orphaned fixture for a pack that no longer exists', () => {
    const orphans = readdirSync(fixturesDir)
      .filter((name) => name.endsWith('.golden.json'))
      .map((name) => name.replace('.golden.json', ''))
      .filter((id) => !registry.has(id))
    expect(orphans).toEqual([])
  })

  it('is marked SYNTHETIC, because this POC ships no authoritative rates (FR-10)', () => {
    const notSynthetic = registry
      .all()
      .filter((pack) => pack.provenance !== 'SYNTHETIC')
      .map((pack) => pack.id)
    expect(notSynthetic).toEqual([])
  })
})

/**
 * Read a fixture, or return null.
 *
 * This runs during collection, so an unguarded readFileSync throws before
 * any assertion exists to report it: vitest fails the whole FILE with a
 * raw ENOENT and prints "no tests", taking every other pack's cases down
 * with it. CI still goes red, but the operator gets a stack trace instead
 * of "pack ZZ has no fixture" and loses all other results. Returning null
 * keeps the failure attributable and local to the offending pack.
 */
function readFixture(packId: string): GoldenFixtureFile | null {
  const fixturePath = join(fixturesDir, `${packId}.golden.json`)
  if (!existsSync(fixturePath)) return null
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenFixtureFile
}

for (const pack of registry.all()) {
  describe(`pack ${pack.id} (${pack.jurisdictionLabel})`, () => {
    const fixture = readFixture(pack.id)

    if (fixture === null) {
      it(`has a golden fixture file at config/fixtures/${pack.id}.golden.json`, () => {
        expect.fail(
          `pack ${pack.id} loaded but has no fixture file. Every pack must ship ` +
            'golden fixtures (FR-9) — that is what makes adding a jurisdiction ' +
            'a verified change rather than an untested one.',
        )
      })
      return
    }

    it('has a fixture file naming this pack', () => {
      expect(fixture.packId).toBe(pack.id)
    })

    it('declares at least one case', () => {
      expect(fixture.cases.length).toBeGreaterThan(0)
    })

    for (const testCase of fixture.cases) {
      describe(testCase.name, () => {
        const breakdown = computeFee(
          {
            jurisdictionId: pack.id,
            propertyType: testCase.input.propertyType,
            transactionType: testCase.input.transactionType,
            consideration: Money.of(BigInt(testCase.input.considerationMinor), pack.currency),
            marketValue: Money.of(BigInt(testCase.input.marketValueMinor), pack.currency),
            attributes: testCase.input.attributes,
          },
          pack,
        )

        it('resolves the expected chargeable value', () => {
          expect(breakdown.chargeableValue.amountMinor).toBe(testCase.expected.chargeableValueMinor)
        })

        it('computes every applied component to the expected amount', () => {
          const actual = Object.fromEntries(
            breakdown.components
              .filter((component) => component.applied)
              .map((component) => [component.code, component.amount.amountMinor]),
          )
          expect(actual).toEqual(testCase.expected.components)
        })

        it('applies exactly the components the fixture expects to be skipped', () => {
          const actual = breakdown.components
            .filter((component) => !component.applied)
            .map((component) => component.code)
            .sort()
          expect(actual).toEqual([...testCase.expected.notApplied].sort())
        })

        it('totals to the expected amount', () => {
          expect(breakdown.total.amountMinor).toBe(testCase.expected.totalMinor)
        })

        it('totals exactly the sum of its applied components', () => {
          const summed = breakdown.components
            .filter((component) => component.applied)
            .reduce(
              (accumulator, component) => accumulator + BigInt(component.amount.amountMinor),
              0n,
            )
          expect(breakdown.total.amountMinor).toBe(summed.toString())
        })

        it('carries the synthetic disclaimer on the breakdown', () => {
          expect(breakdown.provenance).toBe('SYNTHETIC')
          expect(breakdown.disclaimer).toMatch(/illustrative/i)
        })

        it('reports the pack version, so this fee is reproducible later', () => {
          expect(breakdown.packVersion).toBe(pack.version)
        })
      })
    }
  })
}
