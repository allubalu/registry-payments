import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/index.ts'
import { FeeInputError, computeFee } from '../../src/fees/compute.ts'
import { parseRulePack } from '../../src/fees/schema.ts'
import type { FeeInput } from '../../src/fees/types.ts'

/** A Telangana-shaped pack: proportional rates on the higher of two values. */
const telanganaPack = parseRulePack(
  {
    id: 'IN-TG',
    jurisdictionLabel: 'Telangana, India',
    currency: 'INR',
    version: '2026.1',
    timezone: 'Asia/Kolkata',
    provenance: 'SYNTHETIC',
    basisStrategy: 'MAX_OF_MARKET_AND_CONSIDERATION',
    requiredAttributes: [],
    components: [
      { code: 'STAMP_DUTY', label: 'Stamp duty', kind: 'PROPORTIONAL', ratePpm: 40000 },
      { code: 'TRANSFER_DUTY', label: 'Transfer duty', kind: 'PROPORTIONAL', ratePpm: 15000 },
      { code: 'REGISTRATION_FEE', label: 'Registration fee', kind: 'PROPORTIONAL', ratePpm: 5000 },
      { code: 'USER_CHARGES', label: 'User charges', kind: 'FLAT', amountMinor: '20000' },
    ],
  },
  'inline-test',
)

function input(overrides: Partial<FeeInput> = {}): FeeInput {
  return {
    jurisdictionId: 'IN-TG',
    propertyType: 'APARTMENT',
    transactionType: 'SALE',
    consideration: Money.of(480000000n, 'INR'),
    marketValue: Money.of(500000000n, 'INR'),
    attributes: {},
    ...overrides,
  }
}

describe('computeFee arithmetic', () => {
  const breakdown = computeFee(input(), telanganaPack)

  it('resolves the chargeable value by the pack strategy', () => {
    expect(breakdown.chargeableValue).toEqual({ amountMinor: '500000000', currency: 'INR' })
    expect(breakdown.basisStrategy).toBe('MAX_OF_MARKET_AND_CONSIDERATION')
  })

  it('computes each component', () => {
    const amounts = Object.fromEntries(
      breakdown.components.map((c) => [c.code, c.amount.amountMinor]),
    )
    expect(amounts).toEqual({
      STAMP_DUTY: '20000000',
      TRANSFER_DUTY: '7500000',
      REGISTRATION_FEE: '2500000',
      USER_CHARGES: '20000',
    })
  })

  it('sums the rounded components, never rounding the sum', () => {
    expect(breakdown.total).toEqual({ amountMinor: '30020000', currency: 'INR' })
  })

  it('preserves component order from the pack', () => {
    expect(breakdown.components.map((c) => c.code)).toEqual([
      'STAMP_DUTY',
      'TRANSFER_DUTY',
      'REGISTRATION_FEE',
      'USER_CHARGES',
    ])
  })
})

describe('FeeBreakdown provenance and shape', () => {
  const breakdown = computeFee(input(), telanganaPack)

  it('carries the pack identity so a historical fee is reproducible', () => {
    expect(breakdown.packId).toBe('IN-TG')
    expect(breakdown.packVersion).toBe('2026.1')
  })

  it('carries provenance and a synthetic disclaimer', () => {
    expect(breakdown.provenance).toBe('SYNTHETIC')
    expect(breakdown.disclaimer).toMatch(/illustrative/i)
    expect(breakdown.disclaimer).toMatch(/not.*(official|actual)/i)
  })

  it('is JSON-serialisable with no BigInt leaking out', () => {
    const json = JSON.stringify(breakdown)
    expect(json).toContain('"amountMinor":"30020000"')
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('reports every amount as a string, never a number', () => {
    for (const component of breakdown.components) {
      expect(typeof component.amount.amountMinor).toBe('string')
    }
    expect(typeof breakdown.total.amountMinor).toBe('string')
  })

  it('explains every component in appliedRules', () => {
    for (const component of breakdown.components) {
      expect(component.appliedRules.length).toBeGreaterThan(0)
    }
  })
})

describe('components that do not apply', () => {
  const reliefPack = parseRulePack(
    {
      id: 'GB-ENG',
      jurisdictionLabel: 'England',
      currency: 'GBP',
      version: '2026.1',
      timezone: 'Europe/London',
      provenance: 'SYNTHETIC',
      basisStrategy: 'CONSIDERATION_ONLY',
      requiredAttributes: [{ name: 'firstTimeBuyer', kind: 'boolean', label: 'First-time buyer' }],
      components: [
        { code: 'REGISTRY_FEE', label: 'Land registry fee', kind: 'FLAT', amountMinor: '65000' },
        {
          code: 'FTB_RELIEF',
          label: 'First-time buyer relief',
          kind: 'FLAT',
          amountMinor: '0',
          condition: {
            op: 'all',
            of: [
              { op: 'eq', attribute: 'firstTimeBuyer', value: true },
              { op: 'basisLte', amountMinor: '42500000' },
            ],
          },
        },
      ],
    },
    'inline-test',
  )

  const gbpInput = (firstTimeBuyer: boolean): FeeInput => ({
    jurisdictionId: 'GB-ENG',
    propertyType: 'HOUSE',
    transactionType: 'SALE',
    consideration: Money.of(39500000n, 'GBP'),
    marketValue: Money.of(39500000n, 'GBP'),
    attributes: { firstTimeBuyer },
  })

  it('still lists an excluded component, flagged not applied with a zero amount', () => {
    const breakdown = computeFee(gbpInput(false), reliefPack)
    const relief = breakdown.components.find((c) => c.code === 'FTB_RELIEF')
    expect(relief?.applied).toBe(false)
    expect(relief?.amount.amountMinor).toBe('0')
    expect(relief?.appliedRules.map((r) => r.code)).toContain('NOT_APPLIED')
  })

  it('excludes an unapplied component from the total', () => {
    expect(computeFee(gbpInput(false), reliefPack).total.amountMinor).toBe('65000')
    expect(computeFee(gbpInput(true), reliefPack).total.amountMinor).toBe('65000')
  })

  it('marks an applied component as applied', () => {
    const breakdown = computeFee(gbpInput(true), reliefPack)
    expect(breakdown.components.find((c) => c.code === 'FTB_RELIEF')?.applied).toBe(true)
  })
})

describe('input validation', () => {
  it('rejects a currency that disagrees with the pack', () => {
    expect(() => computeFee(input({ consideration: Money.of(1n, 'GBP') }), telanganaPack)).toThrow(
      FeeInputError,
    )
  })

  it('names both currencies in the error', () => {
    expect(() => computeFee(input({ consideration: Money.of(1n, 'GBP') }), telanganaPack)).toThrow(
      /GBP.*INR|INR.*GBP/,
    )
  })

  it('rejects a jurisdiction id that disagrees with the pack', () => {
    expect(() => computeFee(input({ jurisdictionId: 'GB-ENG' }), telanganaPack)).toThrow(/GB-ENG/)
  })

  it('rejects a negative consideration', () => {
    expect(() => computeFee(input({ consideration: Money.of(-1n, 'INR') }), telanganaPack)).toThrow(
      FeeInputError,
    )
  })

  it('rejects a missing required attribute, naming it', () => {
    const packWithAttribute = parseRulePack(
      {
        id: 'SG',
        jurisdictionLabel: 'Singapore',
        currency: 'SGD',
        version: '2026.1',
        timezone: 'Asia/Singapore',
        provenance: 'SYNTHETIC',
        basisStrategy: 'CONSIDERATION_ONLY',
        requiredAttributes: [
          { name: 'residency', kind: 'string', label: 'Residency', options: ['CITIZEN'] },
        ],
        components: [{ code: 'DUTY', label: 'Duty', kind: 'PROPORTIONAL', ratePpm: 10000 }],
      },
      'inline-test',
    )
    expect(() =>
      computeFee(
        {
          jurisdictionId: 'SG',
          propertyType: 'APARTMENT',
          transactionType: 'SALE',
          consideration: Money.of(1n, 'SGD'),
          marketValue: Money.of(1n, 'SGD'),
          attributes: {},
        },
        packWithAttribute,
      ),
    ).toThrow(/residency/)
  })

  it('rejects an attribute of the wrong declared kind', () => {
    const packWithAttribute = parseRulePack(
      {
        id: 'SG',
        jurisdictionLabel: 'Singapore',
        currency: 'SGD',
        version: '2026.1',
        timezone: 'Asia/Singapore',
        provenance: 'SYNTHETIC',
        basisStrategy: 'CONSIDERATION_ONLY',
        requiredAttributes: [{ name: 'count', kind: 'number', label: 'Count' }],
        components: [{ code: 'DUTY', label: 'Duty', kind: 'PROPORTIONAL', ratePpm: 10000 }],
      },
      'inline-test',
    )
    expect(() =>
      computeFee(
        {
          jurisdictionId: 'SG',
          propertyType: 'APARTMENT',
          transactionType: 'SALE',
          consideration: Money.of(1n, 'SGD'),
          marketValue: Money.of(1n, 'SGD'),
          attributes: { count: 'two' },
        },
        packWithAttribute,
      ),
    ).toThrow(/count/)
  })

  it('rejects a string attribute outside its declared options', () => {
    const packWithOptions = parseRulePack(
      {
        id: 'US-CA',
        jurisdictionLabel: 'California',
        currency: 'USD',
        version: '2026.1',
        timezone: 'America/Los_Angeles',
        provenance: 'SYNTHETIC',
        basisStrategy: 'CONSIDERATION_ONLY',
        requiredAttributes: [
          { name: 'county', kind: 'string', label: 'County', options: ['Alameda', 'Los Angeles'] },
        ],
        components: [
          {
            code: 'TAX',
            label: 'Tax',
            kind: 'PROPORTIONAL',
            ratePpm: 1100,
            condition: { op: 'eq', attribute: 'county', value: 'Alameda' },
          },
        ],
      },
      'inline-test',
    )
    expect(() =>
      computeFee(
        {
          jurisdictionId: 'US-CA',
          propertyType: 'HOUSE',
          transactionType: 'SALE',
          consideration: Money.of(1n, 'USD'),
          marketValue: Money.of(1n, 'USD'),
          attributes: { county: 'Atlantis' },
        },
        packWithOptions,
      ),
    ).toThrow(/Atlantis/)
  })
})

describe('purity', () => {
  it('is deterministic — the same input yields an identical breakdown', () => {
    const first = computeFee(input(), telanganaPack)
    const second = computeFee(input(), telanganaPack)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('does not mutate its input', () => {
    const original = input()
    const snapshot = JSON.stringify({
      attributes: original.attributes,
      consideration: original.consideration.toString(),
    })
    computeFee(original, telanganaPack)
    expect(
      JSON.stringify({
        attributes: original.attributes,
        consideration: original.consideration.toString(),
      }),
    ).toBe(snapshot)
  })
})
