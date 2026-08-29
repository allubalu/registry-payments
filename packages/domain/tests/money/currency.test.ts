import { describe, expect, it } from 'vitest'
import {
  CURRENCIES,
  UnknownCurrencyError,
  currencyOf,
  minorUnitExponent,
  minorUnitsPerMajor,
} from '../../src/money/currency.ts'

describe('currency registry', () => {
  it('gives every ISO 4217 exponent class the spec names', () => {
    expect(minorUnitExponent('INR')).toBe(2)
    expect(minorUnitExponent('GBP')).toBe(2)
    expect(minorUnitExponent('USD')).toBe(2)
    expect(minorUnitExponent('AED')).toBe(2)
    expect(minorUnitExponent('SGD')).toBe(2)
    expect(minorUnitExponent('JPY')).toBe(0)
    expect(minorUnitExponent('KWD')).toBe(3)
    expect(minorUnitExponent('BHD')).toBe(3)
  })

  it('derives minor units per major unit from the exponent, not from a constant', () => {
    expect(minorUnitsPerMajor('GBP')).toBe(100n)
    expect(minorUnitsPerMajor('JPY')).toBe(1n)
    expect(minorUnitsPerMajor('KWD')).toBe(1000n)
  })

  it('resolves a known code', () => {
    expect(currencyOf('JPY')).toEqual({
      code: 'JPY',
      minorUnitExponent: 0,
      displayLocale: 'ja-JP',
    })
  })

  it('throws on an unknown code rather than defaulting', () => {
    expect(() => currencyOf('XYZ')).toThrow(UnknownCurrencyError)
    expect(() => currencyOf('XYZ')).toThrow(/XYZ/)
  })

  it('is frozen, so no caller can mutate a currency definition', () => {
    expect(Object.isFrozen(CURRENCIES)).toBe(true)
    expect(Object.isFrozen(CURRENCIES.JPY)).toBe(true)
  })
})
