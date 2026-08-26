import { describe, expect, it } from 'vitest'
import { divideRounded, roundToStep } from '../../src/money/rounding.ts'

describe('divideRounded', () => {
  it('returns an exact quotient unchanged in every mode', () => {
    expect(divideRounded(100n, 4n, 'HALF_UP')).toBe(25n)
    expect(divideRounded(100n, 4n, 'HALF_EVEN')).toBe(25n)
    expect(divideRounded(100n, 4n, 'CEIL')).toBe(25n)
    expect(divideRounded(100n, 4n, 'FLOOR')).toBe(25n)
  })

  it('rounds an exact half away from zero under HALF_UP', () => {
    expect(divideRounded(5n, 2n, 'HALF_UP')).toBe(3n)
    expect(divideRounded(-5n, 2n, 'HALF_UP')).toBe(-3n)
  })

  it('rounds an exact half to the even neighbour under HALF_EVEN', () => {
    expect(divideRounded(5n, 2n, 'HALF_EVEN')).toBe(2n)
    expect(divideRounded(7n, 2n, 'HALF_EVEN')).toBe(4n)
    expect(divideRounded(-5n, 2n, 'HALF_EVEN')).toBe(-2n)
  })

  it('rounds below and above a half by magnitude, not by mode', () => {
    expect(divideRounded(4n, 3n, 'HALF_UP')).toBe(1n)
    expect(divideRounded(5n, 3n, 'HALF_UP')).toBe(2n)
  })

  it('treats CEIL as toward positive infinity, including for negatives', () => {
    expect(divideRounded(7n, 2n, 'CEIL')).toBe(4n)
    expect(divideRounded(-7n, 2n, 'CEIL')).toBe(-3n)
  })

  it('treats FLOOR as toward negative infinity, including for negatives', () => {
    expect(divideRounded(7n, 2n, 'FLOOR')).toBe(3n)
    expect(divideRounded(-7n, 2n, 'FLOOR')).toBe(-4n)
  })

  it('handles a negative denominator by sign, not by accident', () => {
    expect(divideRounded(7n, -2n, 'FLOOR')).toBe(-4n)
    expect(divideRounded(-7n, -2n, 'FLOOR')).toBe(3n)
  })

  it('refuses to divide by zero', () => {
    expect(() => divideRounded(1n, 0n, 'HALF_UP')).toThrow(/zero/i)
  })
})

describe('roundToStep', () => {
  it('is the identity when the step is one minor unit', () => {
    expect(roundToStep(12345n, 1n, 'HALF_UP')).toBe(12345n)
  })

  it('rounds up to the nearest whole major unit when asked', () => {
    // 123.45 -> 124.00 in a 2-exponent currency: step 100
    expect(roundToStep(12345n, 100n, 'CEIL')).toBe(12400n)
    expect(roundToStep(12300n, 100n, 'CEIL')).toBe(12300n)
  })

  it('rounds to the nearest step under HALF_UP', () => {
    expect(roundToStep(12350n, 100n, 'HALF_UP')).toBe(12400n)
    expect(roundToStep(12349n, 100n, 'HALF_UP')).toBe(12300n)
  })

  it('rejects a non-positive step', () => {
    expect(() => roundToStep(100n, 0n, 'HALF_UP')).toThrow(/step/i)
    expect(() => roundToStep(100n, -10n, 'HALF_UP')).toThrow(/step/i)
  })
})
