import { describe, expect, it } from 'vitest'
import { InvalidRulePackError, parseRulePack } from '../../src/fees/schema.ts'

/** A minimal valid pack. Individual tests override one field at a time. */
function validPack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ZZ',
    jurisdictionLabel: 'Test Jurisdiction',
    currency: 'GBP',
    version: '2026.1',
    timezone: 'Europe/London',
    provenance: 'SYNTHETIC',
    packSource: null,
    packRetrievedAt: null,
    basisStrategy: 'CONSIDERATION_ONLY',
    requiredAttributes: [],
    components: [{ code: 'FEE', label: 'Fee', kind: 'FLAT', amountMinor: '65000' }],
    ...overrides,
  }
}

describe('parseRulePack defaults', () => {
  it('defaults an omitted condition to always', () => {
    const pack = parseRulePack(validPack(), 'test.json')
    expect(pack.components[0]?.condition).toEqual({ op: 'always' })
  })

  it('defaults rounding to HALF_UP and the step to one minor unit', () => {
    const pack = parseRulePack(validPack(), 'test.json')
    expect(pack.components[0]?.rounding).toBe('HALF_UP')
    expect(pack.components[0]?.roundToStepMinor).toBe('1')
  })

  it('defaults optional bounds and modifiers to null', () => {
    const pack = parseRulePack(validPack(), 'test.json')
    const component = pack.components[0]
    expect(component?.minAmountMinor).toBeNull()
    expect(component?.maxAmountMinor).toBeNull()
    expect(component?.kind === 'FLAT' && component.timesAttribute).toBeNull()
  })
})

describe('provenance guard (FR-10)', () => {
  it('accepts a SYNTHETIC pack with no citation', () => {
    expect(() =>
      parseRulePack(validPack({ provenance: 'SYNTHETIC' }), 'test.json'),
    ).not.toThrow()
  })

  it('rejects a SOURCED pack with no citation URL', () => {
    expect(() =>
      parseRulePack(
        validPack({ provenance: 'SOURCED', packSource: null, packRetrievedAt: '2026-01-01' }),
        'test.json',
      ),
    ).toThrow(/packSource/)
  })

  it('rejects a SOURCED pack with no retrieval date', () => {
    expect(() =>
      parseRulePack(
        validPack({
          provenance: 'SOURCED',
          packSource: 'https://example.gov',
          packRetrievedAt: null,
        }),
        'test.json',
      ),
    ).toThrow(/packRetrievedAt/)
  })

  it('rejects an unmarked provenance — there is no third state', () => {
    expect(() => parseRulePack(validPack({ provenance: undefined }), 'test.json')).toThrow(
      InvalidRulePackError,
    )
    expect(() => parseRulePack(validPack({ provenance: 'UNKNOWN' }), 'test.json')).toThrow(
      InvalidRulePackError,
    )
  })
})

describe('structural validation', () => {
  it('names the source file in the error, so a boot failure is actionable', () => {
    expect(() => parseRulePack(validPack({ currency: 'XYZ' }), 'GB-ENG-2026.1.json')).toThrow(
      /GB-ENG-2026\.1\.json/,
    )
  })

  it('rejects an unknown currency', () => {
    expect(() => parseRulePack(validPack({ currency: 'XYZ' }), 'test.json')).toThrow(
      InvalidRulePackError,
    )
  })

  it('rejects a pack with no components', () => {
    expect(() => parseRulePack(validPack({ components: [] }), 'test.json')).toThrow(/component/i)
  })

  it('rejects duplicate component codes, which would make a breakdown ambiguous', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [
            { code: 'FEE', label: 'A', kind: 'FLAT', amountMinor: '1' },
            { code: 'FEE', label: 'B', kind: 'FLAT', amountMinor: '2' },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/duplicate/i)
  })

  it('rejects unknown fields rather than ignoring a typo', () => {
    expect(() => parseRulePack(validPack({ basisStratergy: 'MARKET_ONLY' }), 'test.json')).toThrow(
      InvalidRulePackError,
    )
  })

  it('rejects a non-integer ratePpm', () => {
    expect(() =>
      parseRulePack(
        validPack({ components: [{ code: 'D', label: 'D', kind: 'PROPORTIONAL', ratePpm: 4.5 }] }),
        'test.json',
      ),
    ).toThrow(InvalidRulePackError)
  })

  it('rejects a float-looking amountMinor', () => {
    expect(() =>
      parseRulePack(
        validPack({ components: [{ code: 'F', label: 'F', kind: 'FLAT', amountMinor: '650.00' }] }),
        'test.json',
      ),
    ).toThrow(InvalidRulePackError)
  })

  it('rejects bands that are not strictly ascending', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [
            {
              code: 'B',
              label: 'B',
              kind: 'PROGRESSIVE_BANDS',
              bands: [
                { upToMinor: '30000000', ratePpm: 20000 },
                { upToMinor: '15000000', ratePpm: 30000 },
              ],
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/ascending/i)
  })

  it('rejects a bounded final band, because value above it would be uncharged', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [
            {
              code: 'B',
              label: 'B',
              kind: 'PROGRESSIVE_BANDS',
              bands: [{ upToMinor: '15000000', ratePpm: 0 }],
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/final band/i)
  })

  it('rejects a min above a max', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [
            {
              code: 'F',
              label: 'F',
              kind: 'FLAT',
              amountMinor: '100',
              minAmountMinor: '900',
              maxAmountMinor: '100',
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/minAmountMinor/)
  })

  it('rejects a component referencing an attribute the pack never declares', () => {
    expect(() =>
      parseRulePack(
        validPack({
          requiredAttributes: [],
          components: [
            {
              code: 'M',
              label: 'M',
              kind: 'PROPORTIONAL',
              ratePpm: 2500,
              basisAttribute: 'loanAmountMinor',
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/loanAmountMinor/)
  })

  it('rejects a condition referencing an undeclared attribute', () => {
    expect(() =>
      parseRulePack(
        validPack({
          requiredAttributes: [],
          components: [
            {
              code: 'F',
              label: 'F',
              kind: 'FLAT',
              amountMinor: '1',
              condition: { op: 'eq', attribute: 'county', value: 'Alameda' },
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/county/)
  })

  it('accepts a declared attribute used by a condition and a basis', () => {
    expect(() =>
      parseRulePack(
        validPack({
          requiredAttributes: [
            { name: 'county', kind: 'string', label: 'County', options: ['Alameda'] },
            { name: 'loanAmountMinor', kind: 'number', label: 'Loan amount' },
          ],
          components: [
            {
              code: 'M',
              label: 'M',
              kind: 'PROPORTIONAL',
              ratePpm: 2500,
              basisAttribute: 'loanAmountMinor',
              condition: { op: 'eq', attribute: 'county', value: 'Alameda' },
            },
          ],
        }),
        'test.json',
      ),
    ).not.toThrow()
  })

  it('accepts a nested all-of condition', () => {
    const pack = parseRulePack(
      validPack({
        requiredAttributes: [
          { name: 'firstTimeBuyer', kind: 'boolean', label: 'First-time buyer' },
        ],
        components: [
          {
            code: 'R',
            label: 'Relief',
            kind: 'FLAT',
            amountMinor: '1',
            condition: {
              op: 'all',
              of: [
                { op: 'eq', attribute: 'firstTimeBuyer', value: true },
                { op: 'basisLte', amountMinor: '42500000' },
              ],
            },
          },
        ],
      }),
      'test.json',
    )
    expect(pack.components[0]?.condition.op).toBe('all')
  })
})
