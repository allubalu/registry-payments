import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/index.ts'
import {
  AttributeTypeError,
  MissingAttributeError,
  describeCondition,
  evaluateCondition,
} from '../../src/fees/condition.ts'

const ctx = (
  attributes: Record<string, string | number | boolean>,
  chargeableMinor = 39500000n,
) => ({ attributes, chargeableValue: Money.of(chargeableMinor, 'GBP') })

describe('evaluateCondition', () => {
  it('always is true', () => {
    expect(evaluateCondition({ op: 'always' }, ctx({}))).toBe(true)
  })

  it('eq matches a string, a number and a boolean', () => {
    expect(
      evaluateCondition(
        { op: 'eq', attribute: 'county', value: 'Alameda' },
        ctx({ county: 'Alameda' }),
      ),
    ).toBe(true)
    expect(
      evaluateCondition(
        { op: 'eq', attribute: 'county', value: 'Alameda' },
        ctx({ county: 'Marin' }),
      ),
    ).toBe(false)
    expect(
      evaluateCondition(
        { op: 'eq', attribute: 'firstTimeBuyer', value: true },
        ctx({ firstTimeBuyer: true }),
      ),
    ).toBe(true)
    expect(
      evaluateCondition(
        { op: 'eq', attribute: 'firstTimeBuyer', value: true },
        ctx({ firstTimeBuyer: false }),
      ),
    ).toBe(false)
    expect(
      evaluateCondition({ op: 'eq', attribute: 'documentCount', value: 2 }, ctx({ documentCount: 2 })),
    ).toBe(true)
  })

  it('does not coerce across types — "true" is not true', () => {
    expect(
      evaluateCondition(
        { op: 'eq', attribute: 'firstTimeBuyer', value: true },
        ctx({ firstTimeBuyer: 'true' }),
      ),
    ).toBe(false)
  })

  it('lte and gte compare numbers inclusively', () => {
    expect(evaluateCondition({ op: 'lte', attribute: 'n', value: 5 }, ctx({ n: 5 }))).toBe(true)
    expect(evaluateCondition({ op: 'lte', attribute: 'n', value: 5 }, ctx({ n: 6 }))).toBe(false)
    expect(evaluateCondition({ op: 'gte', attribute: 'n', value: 5 }, ctx({ n: 5 }))).toBe(true)
    expect(evaluateCondition({ op: 'gte', attribute: 'n', value: 5 }, ctx({ n: 4 }))).toBe(false)
  })

  it('basisLte and basisGte compare the chargeable value inclusively', () => {
    expect(evaluateCondition({ op: 'basisLte', amountMinor: '39500000' }, ctx({}))).toBe(true)
    expect(evaluateCondition({ op: 'basisLte', amountMinor: '39499999' }, ctx({}))).toBe(false)
    expect(evaluateCondition({ op: 'basisGte', amountMinor: '39500000' }, ctx({}))).toBe(true)
    expect(evaluateCondition({ op: 'basisGte', amountMinor: '39500001' }, ctx({}))).toBe(false)
  })

  it('not inverts', () => {
    expect(evaluateCondition({ op: 'not', of: { op: 'always' } }, ctx({}))).toBe(false)
  })

  it('all requires every child', () => {
    const condition = {
      op: 'all' as const,
      of: [
        { op: 'eq' as const, attribute: 'firstTimeBuyer', value: true },
        { op: 'basisLte' as const, amountMinor: '42500000' },
      ],
    }
    expect(evaluateCondition(condition, ctx({ firstTimeBuyer: true }))).toBe(true)
    expect(evaluateCondition(condition, ctx({ firstTimeBuyer: false }))).toBe(false)
    expect(evaluateCondition(condition, ctx({ firstTimeBuyer: true }, 50000000n))).toBe(false)
  })

  it('any requires one child', () => {
    const condition = {
      op: 'any' as const,
      of: [
        { op: 'eq' as const, attribute: 'county', value: 'Alameda' },
        { op: 'eq' as const, attribute: 'county', value: 'Marin' },
      ],
    }
    expect(evaluateCondition(condition, ctx({ county: 'Marin' }))).toBe(true)
    expect(evaluateCondition(condition, ctx({ county: 'Yolo' }))).toBe(false)
  })

  it('THROWS on a missing attribute rather than quietly evaluating false', () => {
    expect(() => evaluateCondition({ op: 'eq', attribute: 'county', value: 'X' }, ctx({}))).toThrow(
      MissingAttributeError,
    )
  })

  it('names the missing attribute', () => {
    expect(() => evaluateCondition({ op: 'eq', attribute: 'county', value: 'X' }, ctx({}))).toThrow(
      /county/,
    )
  })

  it('throws when a numeric comparison receives a non-number', () => {
    expect(() =>
      evaluateCondition({ op: 'lte', attribute: 'n', value: 5 }, ctx({ n: 'five' })),
    ).toThrow(AttributeTypeError)
  })
})

describe('describeCondition', () => {
  it('renders a leaf legibly for the breakdown', () => {
    expect(describeCondition({ op: 'always' })).toBe('always applies')
    expect(describeCondition({ op: 'eq', attribute: 'county', value: 'Alameda' })).toBe(
      'county equals "Alameda"',
    )
    expect(describeCondition({ op: 'basisLte', amountMinor: '42500000' })).toBe(
      'chargeable value at most 42500000 minor units',
    )
  })

  it('renders a compound condition', () => {
    expect(
      describeCondition({
        op: 'all',
        of: [
          { op: 'eq', attribute: 'firstTimeBuyer', value: true },
          { op: 'basisLte', amountMinor: '42500000' },
        ],
      }),
    ).toBe('all of (firstTimeBuyer equals true; chargeable value at most 42500000 minor units)')
  })

  it('renders a negation', () => {
    expect(describeCondition({ op: 'not', of: { op: 'always' } })).toBe('not (always applies)')
  })
})
