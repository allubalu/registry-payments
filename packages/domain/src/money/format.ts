import { currencyOf, minorUnitExponent } from './currency.ts'
import type { Money } from './money.ts'

export interface FormatMoneyOptions {
  /** BCP 47 override. Defaults to the currency's own display locale. */
  readonly locale?: string
  /** Include the currency symbol. Default true. */
  readonly withSymbol?: boolean
}

/**
 * Render money for a human.
 *
 * PRESENTATION ONLY. Never parse the output of this function, never do
 * arithmetic on it, and never send it across the wire as data — use
 * toWire for that.
 *
 * Fraction digits come from the currency's ISO 4217 exponent, so yen
 * renders as ￥1,250,000 and sterling as £6,500.00. A receipt reading
 * ¥1250000.00 is a defect (RCP-2), and this is the only function that
 * could produce one.
 */
export function formatMoney(money: Money, options: FormatMoneyOptions = {}): string {
  const definition = currencyOf(money.currency)
  const exponent = minorUnitExponent(money.currency)
  const locale = options.locale ?? definition.displayLocale
  const withSymbol = options.withSymbol ?? true

  const formatter = new Intl.NumberFormat(locale, {
    ...(withSymbol
      ? { style: 'currency' as const, currency: money.currency }
      : { style: 'decimal' as const }),
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  })

  // Intl accepts an exact decimal STRING and preserves its precision, so
  // an amount above 2^53 formats without drift. Converting to Number here
  // instead would be a silent correctness bug.
  return formatter.format(scaledDecimalString(money.amountMinor, exponent))
}

/**
 * Render an integer minor amount as an exact decimal numeral, e.g.
 * 650000 with exponent 2 -> "6500.00".
 *
 * The return is cast to Intl.StringNumericLiteral, a pattern type the
 * compiler cannot verify a computed string against. The cast is sound:
 * every branch below emits an optional minus followed by digits and at
 * most one decimal point, built from a bigint. Returning plain `string`
 * instead would only move the same cast to each call site.
 */
function scaledDecimalString(
  amountMinor: bigint,
  exponent: number,
): Intl.StringNumericLiteral {
  if (exponent === 0) return amountMinor.toString() as Intl.StringNumericLiteral
  const divisor = 10n ** BigInt(exponent)
  const negative = amountMinor < 0n
  const magnitude = negative ? -amountMinor : amountMinor
  const whole = magnitude / divisor
  const fraction = (magnitude % divisor).toString().padStart(exponent, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}` as Intl.StringNumericLiteral
}
