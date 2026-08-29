import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/index.ts'
import { computeComponent } from '../../src/fees/components.ts'
import type { FeeComponentRule } from '../../src/fees/types.ts'

const gbp = (minor: bigint) => Money.of(minor, 'GBP')

/** Fill in the schema defaults a hand-written rule literal would omit. */
function rule(
  partial: Partial<FeeComponentRule> & Pick<FeeComponentRule, 'kind'>,
): FeeComponentRule {
  return {
    code: 'TEST',
    label: 'Test',
    condition: { op: 'always' },
    rounding: 'HALF_UP',
    roundToStepMinor: '1',
    minAmountMinor: null,
    maxAmountMinor: null,
    ...(partial.kind === 'FLAT' ? { amountMinor: '0', timesAttribute: null } : {}),
    ...(partial.kind === 'PROPORTIONAL' ? { ratePpm: 0, basisAttribute: null } : {}),
    ...(partial.kind === 'PROGRESSIVE_BANDS' ? { bands: [{ upToMinor: null, ratePpm: 0 }] } : {}),
    ...partial,
  } as FeeComponentRule
}

const ctx = (
  chargeableMinor: bigint,
  attributes: Record<string, string | number | boolean> = {},
) => ({
  chargeableValue: gbp(chargeableMinor),
  attributes,
})

describe('conditional application', () => {
  it('returns null when the condition excludes the component', () => {
    const result = computeComponent(
      rule({
        kind: 'FLAT',
        amountMinor: '65000',
        condition: { op: 'eq', attribute: 'ftb', value: true },
      }),
      ctx(39500000n, { ftb: false }),
    )
    expect(result).toBeNull()
  })

  it('computes when the condition includes it', () => {
    const result = computeComponent(
      rule({
        kind: 'FLAT',
        amountMinor: '65000',
        condition: { op: 'eq', attribute: 'ftb', value: true },
      }),
      ctx(39500000n, { ftb: true }),
    )
    expect(result?.amount.amountMinor).toBe(65000n)
  })

  it('records the condition it satisfied in appliedRules', () => {
    const result = computeComponent(
      rule({
        kind: 'FLAT',
        amountMinor: '1',
        condition: { op: 'basisLte', amountMinor: '99999999' },
      }),
      ctx(39500000n),
    )
    expect(result?.appliedRules.map((r) => r.code)).toContain('CONDITION')
    expect(result?.appliedRules.find((r) => r.code === 'CONDITION')?.detail).toMatch(
      /chargeable value at most/,
    )
  })
})

describe('FLAT', () => {
  it('charges a fixed amount and reports no basis or rate', () => {
    const result = computeComponent(rule({ kind: 'FLAT', amountMinor: '65000' }), ctx(39500000n))
    expect(result?.amount.amountMinor).toBe(65000n)
    expect(result?.basis).toBeNull()
    expect(result?.ratePpm).toBeNull()
    expect(result?.bands).toBeNull()
  })

  it('multiplies by a numeric attribute for a per-document fee', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '4750', timesAttribute: 'documentCount' }),
      ctx(85000000n, { documentCount: 2 }),
    )
    expect(result?.amount.amountMinor).toBe(9500n)
  })

  it('records the multiplier in appliedRules', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '4750', timesAttribute: 'documentCount' }),
      ctx(85000000n, { documentCount: 2 }),
    )
    expect(result?.appliedRules.map((r) => r.detail).join(' ')).toMatch(/documentCount.*2/)
  })

  it('throws when the multiplier attribute is missing', () => {
    expect(() =>
      computeComponent(
        rule({ kind: 'FLAT', amountMinor: '4750', timesAttribute: 'documentCount' }),
        ctx(85000000n),
      ),
    ).toThrow(/documentCount/)
  })

  it('throws when the multiplier is not a non-negative integer', () => {
    expect(() =>
      computeComponent(
        rule({ kind: 'FLAT', amountMinor: '10', timesAttribute: 'n' }),
        ctx(1n, { n: 1.5 }),
      ),
    ).toThrow(/integer/i)
    expect(() =>
      computeComponent(
        rule({ kind: 'FLAT', amountMinor: '10', timesAttribute: 'n' }),
        ctx(1n, { n: -1 }),
      ),
    ).toThrow(/negative/i)
  })

  it('yields zero for a multiplier of zero, which is applied-and-zero, not absent', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '4750', timesAttribute: 'documentCount' }),
      ctx(1n, { documentCount: 0 }),
    )
    expect(result).not.toBeNull()
    expect(result?.amount.amountMinor).toBe(0n)
  })
})

describe('PROPORTIONAL', () => {
  it('applies a rate to the chargeable value', () => {
    // 0.11% of 85,000,000 minor = 93,500 minor
    const result = computeComponent(rule({ kind: 'PROPORTIONAL', ratePpm: 1100 }), ctx(85000000n))
    expect(result?.amount.amountMinor).toBe(93500n)
    expect(result?.basis?.amountMinor).toBe(85000000n)
    expect(result?.ratePpm).toBe(1100)
  })

  it('applies a rate to a named attribute basis instead, for a mortgage fee', () => {
    // 0.25% of a 180,000,000 minor loan = 450,000 minor
    const result = computeComponent(
      rule({ kind: 'PROPORTIONAL', ratePpm: 2500, basisAttribute: 'loanAmountMinor' }),
      ctx(240000000n, { loanAmountMinor: 180000000 }),
    )
    expect(result?.amount.amountMinor).toBe(450000n)
    expect(result?.basis?.amountMinor).toBe(180000000n)
  })

  it('throws when the basis attribute is missing or not a non-negative integer', () => {
    expect(() =>
      computeComponent(
        rule({ kind: 'PROPORTIONAL', ratePpm: 2500, basisAttribute: 'loanAmountMinor' }),
        ctx(1n),
      ),
    ).toThrow(/loanAmountMinor/)
    expect(() =>
      computeComponent(
        rule({ kind: 'PROPORTIONAL', ratePpm: 2500, basisAttribute: 'loan' }),
        ctx(1n, { loan: 1.5 }),
      ),
    ).toThrow(/integer/i)
  })

  it('records the rate and basis in appliedRules', () => {
    const result = computeComponent(rule({ kind: 'PROPORTIONAL', ratePpm: 40000 }), ctx(500000000n))
    const text = result?.appliedRules.map((r) => r.detail).join(' ') ?? ''
    expect(text).toMatch(/40000 ppm/)
  })
})

describe('PROGRESSIVE_BANDS', () => {
  /** England-shaped: 0% to 150k, 2% to 300k, 3% above. Amounts in pence. */
  const englandBands = rule({
    kind: 'PROGRESSIVE_BANDS',
    bands: [
      { upToMinor: '15000000', ratePpm: 0 },
      { upToMinor: '30000000', ratePpm: 20000 },
      { upToMinor: null, ratePpm: 30000 },
    ],
  })

  it('charges each band only on its own slice', () => {
    // 395,000.00 -> 0 + (150,000 @ 2% = 3,000) + (95,000 @ 3% = 2,850) = 5,850
    const result = computeComponent(englandBands, ctx(39500000n))
    expect(result?.amount.amountMinor).toBe(585000n)
  })

  it('reports every band it walked, including the untouched ones', () => {
    const result = computeComponent(englandBands, ctx(39500000n))
    expect(result?.bands).toHaveLength(3)
    expect(result?.bands?.[0]).toMatchObject({
      fromMinor: '0',
      toMinor: '15000000',
      slicedMinor: '15000000',
      ratePpm: 0,
    })
    expect(result?.bands?.[1]?.slicedMinor).toBe('15000000')
    expect(result?.bands?.[2]?.slicedMinor).toBe('9500000')
    expect(result?.bands?.[2]?.toMinor).toBeNull()
  })

  it('is exact one minor unit BELOW a bound', () => {
    // 149,999.99 -> entirely in the 0% band
    expect(computeComponent(englandBands, ctx(14999999n))?.amount.amountMinor).toBe(0n)
  })

  it('is exact exactly AT a bound', () => {
    // 150,000.00 -> still entirely 0%, because the bound is inclusive
    expect(computeComponent(englandBands, ctx(15000000n))?.amount.amountMinor).toBe(0n)
  })

  it('is exact one minor unit ABOVE a bound', () => {
    // 150,000.01 -> one pence in the 2% band, rounding HALF_UP to 0
    const result = computeComponent(englandBands, ctx(15000001n))
    expect(result?.bands?.[1]?.slicedMinor).toBe('1')
    expect(result?.amount.amountMinor).toBe(0n)
  })

  it('is exact at the second bound and just above it', () => {
    // 300,000.00 -> 150,000 @ 2% = 3,000.00
    expect(computeComponent(englandBands, ctx(30000000n))?.amount.amountMinor).toBe(300000n)
    // 300,000.01 -> 3,000.00 plus one pence at 3%, HALF_UP to 0
    expect(computeComponent(englandBands, ctx(30000001n))?.amount.amountMinor).toBe(300000n)
  })

  it('charges nothing on a zero chargeable value', () => {
    const result = computeComponent(englandBands, ctx(0n))
    expect(result?.amount.amountMinor).toBe(0n)
    expect(result?.bands?.every((band) => band.slicedMinor === '0')).toBe(true)
  })

  it('rounds the band total once, not each band, and reports no single rate', () => {
    const result = computeComponent(englandBands, ctx(39500000n))
    expect(result?.ratePpm).toBeNull()
    expect(result?.basis?.amountMinor).toBe(39500000n)
  })

  it('walks a Singapore-shaped four-band schedule exactly', () => {
    // 1% to 180k, 2% to 360k, 3% to 1,000k, 4% above, on 1,500,000.00
    const sgBands = rule({
      kind: 'PROGRESSIVE_BANDS',
      bands: [
        { upToMinor: '18000000', ratePpm: 10000 },
        { upToMinor: '36000000', ratePpm: 20000 },
        { upToMinor: '100000000', ratePpm: 30000 },
        { upToMinor: null, ratePpm: 40000 },
      ],
    })
    // 180,000 + 360,000 + 1,920,000 + 2,000,000 = 4,460,000 minor
    expect(computeComponent(sgBands, ctx(150000000n))?.amount.amountMinor).toBe(4460000n)
  })
})

describe('bounds and rounding', () => {
  it('applies a minimum', () => {
    const result = computeComponent(
      rule({ kind: 'PROPORTIONAL', ratePpm: 1100, minAmountMinor: '1000' }),
      ctx(10000n),
    )
    // 0.11% of 10,000 = 11, raised to the 1,000 minimum
    expect(result?.amount.amountMinor).toBe(1000n)
  })

  it('applies a maximum', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '3750', timesAttribute: 'n', maxAmountMinor: '22500' }),
      ctx(1n, { n: 10 }),
    )
    // 37,500 capped at 22,500
    expect(result?.amount.amountMinor).toBe(22500n)
  })

  it('records a bound in appliedRules only when it actually bound', () => {
    const bound = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '37500', maxAmountMinor: '22500' }),
      ctx(1n),
    )
    expect(bound?.appliedRules.map((r) => r.code)).toContain('MAX_APPLIED')

    const unbound = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '7500', maxAmountMinor: '22500' }),
      ctx(1n),
    )
    expect(unbound?.appliedRules.map((r) => r.code)).not.toContain('MAX_APPLIED')
  })

  it('rounds to a coarser step when the pack asks', () => {
    // 4% of 1,234,567 = 49,382.68 -> CEIL to the whole major unit (step 100)
    const result = computeComponent(
      rule({ kind: 'PROPORTIONAL', ratePpm: 40000, roundToStepMinor: '100', rounding: 'CEIL' }),
      ctx(1234567n),
    )
    expect(result?.amount.amountMinor).toBe(49400n)
  })

  it('records the rounding it performed', () => {
    const result = computeComponent(
      rule({ kind: 'PROPORTIONAL', ratePpm: 40000, roundToStepMinor: '100', rounding: 'CEIL' }),
      ctx(1234567n),
    )
    expect(result?.appliedRules.map((r) => r.code)).toContain('ROUNDING')
    expect(result?.appliedRules.find((r) => r.code === 'ROUNDING')?.detail).toMatch(/CEIL/)
  })

  it('applies the minimum after rounding, not before', () => {
    const result = computeComponent(
      rule({
        kind: 'PROPORTIONAL',
        ratePpm: 1,
        rounding: 'FLOOR',
        roundToStepMinor: '1',
        minAmountMinor: '500',
      }),
      ctx(100n),
    )
    // 1 ppm of 100 = 0.0001 -> FLOOR 0 -> raised to 500
    expect(result?.amount.amountMinor).toBe(500n)
  })
})
