import { type CurrencyCode, isCurrencyCode } from './currency.ts'
import { Money } from './money.ts'

/**
 * How money crosses any boundary — HTTP, persisted JSON, a log line.
 * The amount is a decimal integer STRING because JSON has no BigInt and a
 * JS number would silently lose precision above 2^53 (FR-0d).
 */
export interface MoneyWire {
  readonly amountMinor: string
  readonly currency: string
}

/** Decimal integer, optional leading minus. No exponent, no decimal point. */
const MINOR_AMOUNT_PATTERN = /^-?\d+$/

export class InvalidMoneyWireError extends Error {
  readonly received: unknown

  constructor(reason: string, received: unknown) {
    super(`Invalid money payload: ${reason} (received ${JSON.stringify(received)})`)
    this.name = 'InvalidMoneyWireError'
    this.received = received
  }
}

export function toWire(money: Money): MoneyWire {
  return { amountMinor: money.amountMinor.toString(), currency: money.currency }
}

export function fromWire(wire: MoneyWire): Money {
  if (typeof wire?.amountMinor !== 'string') {
    throw new InvalidMoneyWireError(
      'amountMinor must be a decimal integer string',
      wire?.amountMinor,
    )
  }
  if (!MINOR_AMOUNT_PATTERN.test(wire.amountMinor)) {
    throw new InvalidMoneyWireError(
      'amountMinor must be a decimal integer with no decimal point or exponent',
      wire.amountMinor,
    )
  }
  if (typeof wire.currency !== 'string' || !isCurrencyCode(wire.currency)) {
    throw new InvalidMoneyWireError('unknown currency code', wire.currency)
  }
  const currency: CurrencyCode = wire.currency
  return Money.of(BigInt(wire.amountMinor), currency)
}
