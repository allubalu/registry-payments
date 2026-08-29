import {
  type CurrencyCode,
  currencyOf,
  minorUnitsPerMajor,
} from './currency.ts'
import {
  type RoundingMode,
  divideRounded,
  roundToStep,
} from './rounding.ts'

const PPM_DENOMINATOR = 1_000_000n

export class CurrencyMismatchError extends Error {
  readonly left: CurrencyCode
  readonly right: CurrencyCode

  constructor(left: CurrencyCode, right: CurrencyCode, operation: string) {
    super(
      `Cannot ${operation} across currencies: ${left} and ${right}. ` +
        'Mixing currencies is a defect, not a conversion — this system does no FX.',
    )
    this.name = 'CurrencyMismatchError'
    this.left = left
    this.right = right
  }
}

/**
 * An exact amount of money in one currency.
 *
 * Held as an integer count of the currency's minor unit. There is no
 * floating point anywhere in this class and no bare numeric money type in
 * the codebase. Arithmetic across currencies throws.
 */
export class Money {
  readonly amountMinor: bigint
  readonly currency: CurrencyCode

  private constructor(amountMinor: bigint, currency: CurrencyCode) {
    this.amountMinor = amountMinor
    this.currency = currency
    Object.freeze(this)
  }

  static of(amountMinor: bigint, currency: CurrencyCode): Money {
    // Validates the code at runtime; callers may come from parsed JSON.
    currencyOf(currency)
    if (typeof amountMinor !== 'bigint') {
      throw new TypeError(
        `Money.of: amountMinor must be a bigint, got ${typeof amountMinor}`,
      )
    }
    return new Money(amountMinor, currency)
  }

  static zero(currency: CurrencyCode): Money {
    return Money.of(0n, currency)
  }

  /**
   * Convenience for tests and fixtures. Accepts whole major units only —
   * a fractional major unit means the caller is thinking in floats.
   */
  static fromMajorUnits(major: number, currency: CurrencyCode): Money {
    if (!Number.isInteger(major)) {
      throw new RangeError(
        `Money.fromMajorUnits: expected an integer major amount, got ${major}. ` +
          'Construct fractional amounts with Money.of and minor units.',
      )
    }
    return Money.of(BigInt(major) * minorUnitsPerMajor(currency), currency)
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency, operation)
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'add')
    return new Money(this.amountMinor + other.amountMinor, this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract')
    return new Money(this.amountMinor - other.amountMinor, this.currency)
  }

  negate(): Money {
    return new Money(-this.amountMinor, this.currency)
  }

  /**
   * Repeat this amount a whole number of times — a per-document fee charged
   * once per document, say. Exact: no rounding is possible or performed.
   *
   * This exists so a caller never has to reach for `money.amountMinor * n`.
   * That expression is exact too, but it puts bare arithmetic on a minor
   * amount outside the money primitives, which is precisely what the
   * no-float-money guard forbids — the guard cannot tell an exact bigint
   * multiply from the start of a float bug.
   */
  multiplyInteger(count: bigint): Money {
    if (count < 0n) {
      throw new RangeError(`Money.multiplyInteger: count must not be negative, got ${count}`)
    }
    return new Money(this.amountMinor * count, this.currency)
  }

  /**
   * Apply an integer parts-per-million rate. 0.5% is 5000 ppm, 4% is 40000.
   * Rates are never floating-point percentages (FR-6).
   */
  multiplyPpm(ratePpm: number, mode: RoundingMode): Money {
    if (!Number.isInteger(ratePpm)) {
      throw new RangeError(
        `Money.multiplyPpm: ratePpm must be an integer, got ${ratePpm}`,
      )
    }
    if (ratePpm < 0) {
      throw new RangeError(
        `Money.multiplyPpm: ratePpm must not be negative, got ${ratePpm}`,
      )
    }
    const scaled = this.amountMinor * BigInt(ratePpm)
    return new Money(divideRounded(scaled, PPM_DENOMINATOR, mode), this.currency)
  }

  roundTo(stepMinor: bigint, mode: RoundingMode): Money {
    return new Money(roundToStep(this.amountMinor, stepMinor, mode), this.currency)
  }

  clamp(min: Money | null, max: Money | null): Money {
    if (min !== null) this.assertSameCurrency(min, 'clamp')
    if (max !== null) this.assertSameCurrency(max, 'clamp')
    if (min !== null && max !== null && min.amountMinor > max.amountMinor) {
      throw new RangeError(
        `Money.clamp: minimum ${min.amountMinor} exceeds maximum ${max.amountMinor}`,
      )
    }
    let result: bigint = this.amountMinor
    if (min !== null && result < min.amountMinor) result = min.amountMinor
    if (max !== null && result > max.amountMinor) result = max.amountMinor
    return new Money(result, this.currency)
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other, 'compare')
    if (this.amountMinor < other.amountMinor) return -1
    if (this.amountMinor > other.amountMinor) return 1
    return 0
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor
  }

  isZero(): boolean {
    return this.amountMinor === 0n
  }

  isNegative(): boolean {
    return this.amountMinor < 0n
  }

  static max(a: Money, b: Money): Money {
    return a.compare(b) >= 0 ? a : b
  }

  static min(a: Money, b: Money): Money {
    return a.compare(b) <= 0 ? a : b
  }

  /**
   * Sum a list. The currency is explicit so an empty list yields a typed
   * zero rather than throwing — a pack whose every component was
   * conditioned away is legal and totals zero.
   */
  static sum(parts: readonly Money[], currency: CurrencyCode): Money {
    let total = Money.zero(currency)
    for (const part of parts) total = total.add(part)
    return total
  }

  /** Diagnostic only. Never render this to a user — use formatMoney. */
  toString(): string {
    return `${this.amountMinor} ${this.currency}`
  }
}
