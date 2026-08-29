import { describe, expect, it } from 'vitest'
import { CurrencyMismatchError, Money } from '../../src/money/money.ts'

const inr = (minor: bigint) => Money.of(minor, 'INR')
const gbp = (minor: bigint) => Money.of(minor, 'GBP')

describe('Money construction', () => {
  it('carries an exact integer minor amount and its currency', () => {
    const m = inr(30020000n)
    expect(m.amountMinor).toBe(30020000n)
    expect(m.currency).toBe('INR')
  })

  it('builds a typed zero', () => {
    expect(Money.zero('JPY').amountMinor).toBe(0n)
    expect(Money.zero('JPY').currency).toBe('JPY')
  })

  it('converts integral major units using the currency exponent, not a constant', () => {
    expect(Money.fromMajorUnits(200000, 'INR').amountMinor).toBe(20000000n)
    expect(Money.fromMajorUnits(1250000, 'JPY').amountMinor).toBe(1250000n)
  })

  it('rejects a fractional major unit rather than silently truncating', () => {
    expect(() => Money.fromMajorUnits(1.5, 'GBP')).toThrow(/integer/i)
  })

  it('rejects an unknown currency', () => {
    // @ts-expect-error deliberately passing an invalid code to prove the runtime guard
    expect(() => Money.of(1n, 'XYZ')).toThrow(/XYZ/)
  })

  it('is immutable', () => {
    const m = inr(100n)
    expect(Object.isFrozen(m)).toBe(true)
  })
})

describe('Money arithmetic', () => {
  it('adds and subtracts within one currency', () => {
    expect(inr(100n).add(inr(23n)).amountMinor).toBe(123n)
    expect(inr(100n).subtract(inr(23n)).amountMinor).toBe(77n)
  })

  it('permits a negative result, because a refund is negative', () => {
    const result = inr(100n).subtract(inr(250n))
    expect(result.amountMinor).toBe(-150n)
    expect(result.isNegative()).toBe(true)
  })

  it('throws when currencies differ on add', () => {
    expect(() => inr(100n).add(gbp(100n))).toThrow(CurrencyMismatchError)
  })

  it('throws when currencies differ on subtract', () => {
    expect(() => inr(100n).subtract(gbp(100n))).toThrow(CurrencyMismatchError)
  })

  it('names both currencies in the mismatch error', () => {
    try {
      inr(1n).add(gbp(1n))
      expect.unreachable('expected a CurrencyMismatchError')
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyMismatchError)
      const mismatch = error as CurrencyMismatchError
      expect(mismatch.left).toBe('INR')
      expect(mismatch.right).toBe('GBP')
      expect(mismatch.message).toMatch(/INR/)
      expect(mismatch.message).toMatch(/GBP/)
    }
  })

  it('throws when currencies differ on compare, rather than ordering nonsense', () => {
    expect(() => inr(100n).compare(gbp(100n))).toThrow(CurrencyMismatchError)
  })

  it('negates', () => {
    expect(inr(100n).negate().amountMinor).toBe(-100n)
    expect(inr(-100n).negate().amountMinor).toBe(100n)
  })
})

describe('Money.multiplyPpm', () => {
  it('applies an integer parts-per-million rate', () => {
    // 4% of 500000000 paise = 20000000 paise
    expect(inr(500000000n).multiplyPpm(40000, 'HALF_UP').amountMinor).toBe(20000000n)
    // 0.5%
    expect(inr(500000000n).multiplyPpm(5000, 'HALF_UP').amountMinor).toBe(2500000n)
  })

  it('rounds under the mode it is given', () => {
    // 1 ppm of 1 minor unit = 0.000001 -> 0 or 1 depending on mode
    expect(inr(1n).multiplyPpm(1, 'FLOOR').amountMinor).toBe(0n)
    expect(inr(1n).multiplyPpm(1, 'CEIL').amountMinor).toBe(1n)
  })

  it('rounds an exact half under HALF_UP and HALF_EVEN differently', () => {
    // 500000 ppm (50%) of 5 minor units = 2.5
    expect(inr(5n).multiplyPpm(500000, 'HALF_UP').amountMinor).toBe(3n)
    expect(inr(5n).multiplyPpm(500000, 'HALF_EVEN').amountMinor).toBe(2n)
  })

  it('works in a zero-decimal currency', () => {
    // 2% of 60,000,000 yen = 1,200,000 yen
    expect(Money.of(60000000n, 'JPY').multiplyPpm(20000, 'HALF_UP').amountMinor).toBe(1200000n)
  })

  it('preserves currency', () => {
    expect(gbp(100n).multiplyPpm(20000, 'HALF_UP').currency).toBe('GBP')
  })

  it('rejects a non-integer or negative rate', () => {
    expect(() => inr(100n).multiplyPpm(1.5, 'HALF_UP')).toThrow(/integer/i)
    expect(() => inr(100n).multiplyPpm(-1, 'HALF_UP')).toThrow(/negative/i)
  })
})

describe('Money bounds', () => {
  it('clamps to a minimum', () => {
    expect(inr(500n).clamp(inr(1000n), null).amountMinor).toBe(1000n)
    expect(inr(5000n).clamp(inr(1000n), null).amountMinor).toBe(5000n)
  })

  it('clamps to a maximum', () => {
    expect(inr(50000n).clamp(null, inr(22500n)).amountMinor).toBe(22500n)
    expect(inr(7500n).clamp(null, inr(22500n)).amountMinor).toBe(7500n)
  })

  it('is a no-op when both bounds are null', () => {
    expect(inr(777n).clamp(null, null).amountMinor).toBe(777n)
  })

  it('throws when a bound is in another currency', () => {
    expect(() => inr(500n).clamp(gbp(1000n), null)).toThrow(CurrencyMismatchError)
  })

  it('throws when the minimum exceeds the maximum, because that pack is wrong', () => {
    expect(() => inr(500n).clamp(inr(900n), inr(100n))).toThrow(/minimum/i)
  })

  it('rounds to a coarser step', () => {
    expect(inr(12345n).roundTo(100n, 'CEIL').amountMinor).toBe(12400n)
  })
})

describe('Money aggregation', () => {
  it('sums a list', () => {
    const total = Money.sum([inr(20000000n), inr(7500000n), inr(2500000n), inr(20000n)], 'INR')
    expect(total.amountMinor).toBe(30020000n)
  })

  it('sums an empty list to a typed zero', () => {
    expect(Money.sum([], 'GBP').amountMinor).toBe(0n)
    expect(Money.sum([], 'GBP').currency).toBe('GBP')
  })

  it('throws if any part is in another currency', () => {
    expect(() => Money.sum([inr(1n), gbp(1n)], 'INR')).toThrow(CurrencyMismatchError)
  })

  it('throws if a part disagrees with the declared currency', () => {
    expect(() => Money.sum([gbp(1n)], 'INR')).toThrow(CurrencyMismatchError)
  })

  it('picks a maximum and a minimum', () => {
    expect(Money.max(inr(100n), inr(250n)).amountMinor).toBe(250n)
    expect(Money.min(inr(100n), inr(250n)).amountMinor).toBe(100n)
  })

  it('throws when comparing across currencies for a maximum', () => {
    expect(() => Money.max(inr(100n), gbp(250n))).toThrow(CurrencyMismatchError)
  })
})

describe('multiplyInteger', () => {
  it('repeats an amount a whole number of times, exactly', () => {
    expect(Money.of(4750n, 'USD').multiplyInteger(2n).amountMinor).toBe(9500n)
  })

  it('yields zero for a count of zero', () => {
    expect(Money.of(4750n, 'USD').multiplyInteger(0n).isZero()).toBe(true)
  })

  it('preserves the currency', () => {
    expect(Money.of(1n, 'JPY').multiplyInteger(3n).currency).toBe('JPY')
  })

  it('stays exact far above Number.MAX_SAFE_INTEGER', () => {
    expect(Money.of(9007199254740993n, 'USD').multiplyInteger(1000n).amountMinor).toBe(
      9007199254740993000n,
    )
  })

  it('rejects a negative count', () => {
    expect(() => Money.of(1n, 'USD').multiplyInteger(-1n)).toThrow(RangeError)
  })
})
