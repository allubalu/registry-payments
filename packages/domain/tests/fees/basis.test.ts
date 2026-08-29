import { describe, expect, it } from 'vitest'
import { CurrencyMismatchError, Money } from '../../src/money/index.ts'
import type { CurrencyCode } from '../../src/money/index.ts'
import { resolveChargeableValue } from '../../src/fees/basis.ts'
import type { FeeInput } from '../../src/fees/types.ts'

function input(
  considerationMinor: bigint,
  marketMinor: bigint,
  currency: CurrencyCode = 'INR',
): FeeInput {
  return {
    jurisdictionId: 'IN-TG',
    propertyType: 'APARTMENT',
    transactionType: 'SALE',
    consideration: Money.of(considerationMinor, currency),
    marketValue: Money.of(marketMinor, currency),
    attributes: {},
  }
}

describe('resolveChargeableValue', () => {
  it('MAX_OF_MARKET_AND_CONSIDERATION takes the higher, whichever it is', () => {
    expect(
      resolveChargeableValue(input(480000000n, 500000000n), 'MAX_OF_MARKET_AND_CONSIDERATION')
        .amountMinor,
    ).toBe(500000000n)
    expect(
      resolveChargeableValue(input(520000000n, 500000000n), 'MAX_OF_MARKET_AND_CONSIDERATION')
        .amountMinor,
    ).toBe(520000000n)
  })

  it('is stable when the two values are equal', () => {
    expect(
      resolveChargeableValue(input(500000000n, 500000000n), 'MAX_OF_MARKET_AND_CONSIDERATION')
        .amountMinor,
    ).toBe(500000000n)
  })

  it('CONSIDERATION_ONLY ignores a higher market value', () => {
    expect(
      resolveChargeableValue(input(480000000n, 500000000n), 'CONSIDERATION_ONLY').amountMinor,
    ).toBe(480000000n)
  })

  it('MARKET_ONLY ignores a higher consideration', () => {
    expect(resolveChargeableValue(input(520000000n, 500000000n), 'MARKET_ONLY').amountMinor).toBe(
      500000000n,
    )
  })

  it('preserves the currency', () => {
    expect(resolveChargeableValue(input(1n, 2n, 'JPY'), 'MARKET_ONLY').currency).toBe('JPY')
  })

  it('throws when the two input amounts are in different currencies', () => {
    const mixed: FeeInput = {
      ...input(1n, 2n),
      marketValue: Money.of(2n, 'GBP'),
    }
    expect(() => resolveChargeableValue(mixed, 'MAX_OF_MARKET_AND_CONSIDERATION')).toThrow(
      CurrencyMismatchError,
    )
  })

  it('rejects a negative chargeable value', () => {
    expect(() => resolveChargeableValue(input(-1n, -1n), 'CONSIDERATION_ONLY')).toThrow(/negative/i)
  })
})
