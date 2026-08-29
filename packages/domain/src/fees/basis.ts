import { Money } from '../money/index.ts'
import type { BasisStrategy, FeeInput } from './types.ts'

/**
 * Decide the value the fees are charged on (FR-3).
 *
 * Jurisdictions differ genuinely here — India charges on the higher of
 * market value and price paid, England and Dubai on the price paid. The
 * pack names the strategy; the engine applies the named one and never
 * branches on a jurisdiction id.
 */
export function resolveChargeableValue(input: FeeInput, strategy: BasisStrategy): Money {
  const value = selectValue(input, strategy)
  if (value.isNegative()) {
    throw new RangeError(
      `Chargeable value is negative (${value.toString()}) under strategy ${strategy}`,
    )
  }
  return value
}

function selectValue(input: FeeInput, strategy: BasisStrategy): Money {
  switch (strategy) {
    case 'MAX_OF_MARKET_AND_CONSIDERATION':
      // Money.max throws on a currency mismatch, which is the guard for
      // an input assembled from two differently-denominated sources.
      return Money.max(input.marketValue, input.consideration)
    case 'CONSIDERATION_ONLY':
      return input.consideration
    case 'MARKET_ONLY':
      return input.marketValue
  }
}
