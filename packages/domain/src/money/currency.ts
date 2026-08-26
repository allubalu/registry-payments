export type CurrencyCode =
  | 'INR'
  | 'GBP'
  | 'JPY'
  | 'AED'
  | 'USD'
  | 'SGD'
  | 'KWD'
  | 'BHD'

export interface CurrencyDefinition {
  readonly code: CurrencyCode
  /** ISO 4217 minor unit exponent. Never assume 2 — JPY is 0, KWD is 3. */
  readonly minorUnitExponent: number
  /** BCP 47 tag used for presentation only. Never used in arithmetic. */
  readonly displayLocale: string
}

export class UnknownCurrencyError extends Error {
  constructor(readonly code: string) {
    super(`Unknown currency code: ${code}`)
    this.name = 'UnknownCurrencyError'
  }
}

function define(
  code: CurrencyCode,
  minorUnitExponent: number,
  displayLocale: string,
): CurrencyDefinition {
  return Object.freeze({ code, minorUnitExponent, displayLocale })
}

export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyDefinition>> =
  Object.freeze({
    INR: define('INR', 2, 'en-IN'),
    GBP: define('GBP', 2, 'en-GB'),
    JPY: define('JPY', 0, 'ja-JP'),
    AED: define('AED', 2, 'en-AE'),
    USD: define('USD', 2, 'en-US'),
    SGD: define('SGD', 2, 'en-SG'),
    KWD: define('KWD', 3, 'ar-KW'),
    BHD: define('BHD', 3, 'ar-BH'),
  })

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCIES, code)
}

export function currencyOf(code: string): CurrencyDefinition {
  if (!isCurrencyCode(code)) throw new UnknownCurrencyError(code)
  return CURRENCIES[code]
}

export function minorUnitExponent(code: CurrencyCode): number {
  return CURRENCIES[code].minorUnitExponent
}

export function minorUnitsPerMajor(code: CurrencyCode): bigint {
  return 10n ** BigInt(minorUnitExponent(code))
}
