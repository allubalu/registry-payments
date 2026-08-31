/**
 * Money presentation for the client.
 *
 * Two rules govern everything here.
 *
 * 1. **Never divide by 100.** Minor units are per-currency: JPY has none, BHD
 *    has three. The exponent is read from `Intl.NumberFormat`, which already
 *    knows it, rather than restated in a table the client would have to keep in
 *    step with the domain's currency registry.
 *
 * 2. **Never convert an amount to a JS number.** `amountMinor` arrives as a
 *    string precisely because a number loses precision above 2^53.
 *    `Intl.NumberFormat.prototype.format` accepts a decimal string and formats
 *    it at arbitrary precision, so the string is carried all the way to the
 *    rendered glyphs.
 */

export interface MoneyWire {
  readonly amountMinor: string
  readonly currency: string
}

/** How many minor-unit digits this currency has, per the runtime's own data. */
export function fractionDigits(currency: string): number {
  const { maximumFractionDigits } = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions()

  // Always present for style:'currency' at runtime; the type marks it optional
  // because other number styles may omit it. Falling back to 2 matches the ISO
  // 4217 default, and a currency the runtime does not know is one the API would
  // reject anyway — the client is not the place that decision is made.
  return maximumFractionDigits ?? 2
}

/**
 * Turns a minor-unit integer string into a decimal string, by moving the point.
 * Pure string surgery — no arithmetic, so no precision to lose.
 */
export function minorToDecimalString(amountMinor: string, currency: string): string {
  const digits = fractionDigits(currency)
  const negative = amountMinor.startsWith('-')
  const magnitude = negative ? amountMinor.slice(1) : amountMinor

  if (digits === 0) return `${negative ? '-' : ''}${magnitude}`

  const padded = magnitude.padStart(digits + 1, '0')
  const whole = padded.slice(0, padded.length - digits)
  const fraction = padded.slice(padded.length - digits)

  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/**
 * Formats money for display.
 *
 * Known limitation, carried from ENGINEERING-NOTES.md rather than worked
 * around: no locale and `currencyDisplay` combination renders SGD as `S$`. It
 * renders as `$`, the same as USD. A hand-rolled symbol table would fix the
 * glyph and break every other currency's locale conventions, so it stays.
 */
export function formatMoney(money: MoneyWire, locale?: string): string {
  const decimal = minorToDecimalString(money.amountMinor, money.currency)

  // Intl.NumberFormat V3 formats a decimal string at arbitrary precision, which
  // is the only way to render an amount above 2^53 correctly. TypeScript types
  // the parameter as the template literal `${number}`, which a string built at
  // runtime cannot be narrowed to — so this downcast asserts what
  // minorToDecimalString guarantees by construction. It is not routing around a
  // real type error; passing a JS number here is the bug it prevents.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(decimal as Intl.StringNumericLiteral)
}

/** Formats a rate held as integer parts-per-million (FR-6). 5000 ppm → "0.5%". */
export function formatRatePpm(ratePpm: number): string {
  return `${(ratePpm / 10_000).toLocaleString('en', { maximumFractionDigits: 4 })}%`
}

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAmountError'
  }
}

/**
 * Converts what a person typed, in major units, into the minor-unit string the
 * API expects. `"425,000.5"` in GBP becomes `"42500050"`.
 *
 * String-based for the same reason as the formatter: a large consideration must
 * survive the round trip, and `parseFloat` would quietly round it.
 */
export function majorToMinorUnits(input: string, currency: string): string {
  const cleaned = input.replaceAll(',', '').replaceAll(' ', '').trim()
  if (cleaned === '') throw new InvalidAmountError('enter an amount')

  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned)
  if (match === null) throw new InvalidAmountError('amounts may contain only digits and one decimal point')

  const [, sign = '', whole = '', fractionInput = ''] = match
  if (whole === '' && fractionInput === '') throw new InvalidAmountError('enter an amount')

  const digits = fractionDigits(currency)
  if (fractionInput.length > digits) {
    throw new InvalidAmountError(
      digits === 0
        ? `${currency} has no minor units, so it takes whole amounts only`
        : `${currency} has ${digits} decimal places`,
    )
  }

  const fraction = fractionInput.padEnd(digits, '0')
  const minor = `${whole === '' ? '0' : whole}${fraction}`.replace(/^0+(?=\d)/, '')

  return `${sign}${minor}`
}
