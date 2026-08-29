export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'CEIL' | 'FLOOR'

export const ROUNDING_MODES: readonly RoundingMode[] = Object.freeze([
  'HALF_UP',
  'HALF_EVEN',
  'CEIL',
  'FLOOR',
] as const)

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

/**
 * Divide two integers and round the result under an explicit mode.
 *
 * Every rounded money operation in the engine goes through here. Plain
 * bigint division truncates toward zero, which is none of the four modes
 * the rule packs may name.
 *
 * CEIL is toward positive infinity and FLOOR toward negative infinity —
 * they are NOT "away from zero" and "toward zero". Refunds are negative,
 * so the distinction is load-bearing.
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (denominator === 0n) {
    throw new RangeError('divideRounded: cannot divide by zero')
  }

  const isNegative = numerator < 0n !== denominator < 0n
  const absNumerator = abs(numerator)
  const absDenominator = abs(denominator)

  const quotient = absNumerator / absDenominator
  const remainder = absNumerator % absDenominator

  if (remainder === 0n) return isNegative ? -quotient : quotient

  let magnitude: bigint
  switch (mode) {
    case 'FLOOR':
      // toward -inf: negatives grow in magnitude, positives truncate
      magnitude = isNegative ? quotient + 1n : quotient
      break
    case 'CEIL':
      // toward +inf: positives grow in magnitude, negatives truncate
      magnitude = isNegative ? quotient : quotient + 1n
      break
    case 'HALF_UP':
      magnitude = remainder * 2n >= absDenominator ? quotient + 1n : quotient
      break
    case 'HALF_EVEN': {
      const twiceRemainder = remainder * 2n
      if (twiceRemainder > absDenominator) magnitude = quotient + 1n
      else if (twiceRemainder < absDenominator) magnitude = quotient
      else magnitude = quotient % 2n === 0n ? quotient : quotient + 1n
      break
    }
  }

  return isNegative ? -magnitude : magnitude
}

/**
 * Round an amount to a coarser step than one minor unit.
 *
 * Some jurisdictions round duty up to the nearest whole currency unit; a
 * pack expresses that as a step of 10^exponent with mode CEIL.
 */
export function roundToStep(
  amountMinor: bigint,
  stepMinor: bigint,
  mode: RoundingMode,
): bigint {
  if (stepMinor <= 0n) {
    throw new RangeError(`roundToStep: step must be positive, got ${stepMinor}`)
  }
  if (stepMinor === 1n) return amountMinor
  return divideRounded(amountMinor, stepMinor, mode) * stepMinor
}
