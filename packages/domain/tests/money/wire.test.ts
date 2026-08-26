import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/money.ts'
import { InvalidMoneyWireError, fromWire, toWire } from '../../src/money/wire.ts'

describe('toWire', () => {
  it('emits the amount as a string, because JSON has no BigInt', () => {
    const wire = toWire(Money.of(30020000n, 'INR'))
    expect(wire).toEqual({ amountMinor: '30020000', currency: 'INR' })
    expect(typeof wire.amountMinor).toBe('string')
  })

  it('emits a negative amount as a signed string', () => {
    expect(toWire(Money.of(-650000n, 'GBP')).amountMinor).toBe('-650000')
  })

  it('survives a JSON round trip', () => {
    const original = Money.of(1250000n, 'JPY')
    const parsed = fromWire(JSON.parse(JSON.stringify(toWire(original))))
    expect(parsed.equals(original)).toBe(true)
  })

  it('survives a round trip above Number.MAX_SAFE_INTEGER without drift', () => {
    const original = Money.of(9007199254740993n, 'JPY')
    expect(fromWire(toWire(original)).amountMinor).toBe(9007199254740993n)
  })
})

describe('fromWire', () => {
  it('parses a valid payload', () => {
    const money = fromWire({ amountMinor: '493000', currency: 'USD' })
    expect(money.amountMinor).toBe(493000n)
    expect(money.currency).toBe('USD')
  })

  it('parses a negative amount', () => {
    expect(fromWire({ amountMinor: '-1', currency: 'USD' }).amountMinor).toBe(-1n)
  })

  it('rejects a floating point amount rather than truncating it', () => {
    expect(() => fromWire({ amountMinor: '123.45', currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
  })

  it('rejects a number where a string is required', () => {
    // @ts-expect-error deliberately passing a number to prove the runtime guard
    expect(() => fromWire({ amountMinor: 12345, currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
  })

  it('rejects an empty or non-numeric amount', () => {
    expect(() => fromWire({ amountMinor: '', currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
    expect(() => fromWire({ amountMinor: 'NaN', currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
    expect(() => fromWire({ amountMinor: '1e5', currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
  })

  it('rejects an unknown currency', () => {
    expect(() => fromWire({ amountMinor: '1', currency: 'XYZ' })).toThrow(
      InvalidMoneyWireError,
    )
  })

  it('names the offending value in the error, for a legible API 400', () => {
    expect(() => fromWire({ amountMinor: '1.5', currency: 'USD' })).toThrow(/1\.5/)
  })
})
