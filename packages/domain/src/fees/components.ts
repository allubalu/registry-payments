import { Money } from '../money/index.ts'
import {
  AttributeTypeError,
  MissingAttributeError,
  describeCondition,
  evaluateCondition,
} from './condition.ts'
import type { AppliedRule, AttributeValue, ComputedBand, FeeComponentRule } from './types.ts'

export interface ComponentContext {
  readonly chargeableValue: Money
  readonly attributes: Readonly<Record<string, AttributeValue>>
}

export interface ComponentComputation {
  readonly amount: Money
  readonly basis: Money | null
  readonly ratePpm: number | null
  readonly bands: readonly ComputedBand[] | null
  readonly appliedRules: readonly AppliedRule[]
}

function readNonNegativeInteger(
  attributes: Readonly<Record<string, AttributeValue>>,
  name: string,
): bigint {
  if (!Object.hasOwn(attributes, name)) throw new MissingAttributeError(name)
  const value = attributes[name]
  if (typeof value !== 'number') throw new AttributeTypeError(name, 'number', value)
  if (!Number.isInteger(value)) {
    throw new AttributeTypeError(name, 'integer', value)
  }
  if (value < 0) {
    throw new AttributeTypeError(name, 'non-negative integer', value)
  }
  return BigInt(value)
}

/**
 * Compute one fee component, or return null when its condition excludes it.
 *
 * Null and a zero amount are different facts: "relief not applied" and
 * "relief applied, worth nothing" render differently in a breakdown, and
 * only the caller knows which it is looking at.
 */
export function computeComponent(
  rule: FeeComponentRule,
  ctx: ComponentContext,
): ComponentComputation | null {
  const conditionContext = {
    attributes: ctx.attributes,
    chargeableValue: ctx.chargeableValue,
  }
  if (!evaluateCondition(rule.condition, conditionContext)) return null

  const appliedRules: AppliedRule[] = [
    { code: 'CONDITION', detail: describeCondition(rule.condition) },
  ]

  const currency = ctx.chargeableValue.currency
  let raw: Money
  let basis: Money | null = null
  let ratePpm: number | null = null
  let bands: ComputedBand[] | null = null

  switch (rule.kind) {
    case 'FLAT': {
      const unit = Money.of(BigInt(rule.amountMinor), currency)
      if (rule.timesAttribute === null) {
        raw = unit
        appliedRules.push({
          code: 'FLAT',
          detail: `flat ${rule.amountMinor} minor units`,
        })
      } else {
        const multiplier = readNonNegativeInteger(ctx.attributes, rule.timesAttribute)
        raw = Money.of(unit.amountMinor * multiplier, currency)
        appliedRules.push({
          code: 'FLAT',
          detail: `flat ${rule.amountMinor} minor units times ${rule.timesAttribute} = ${multiplier}`,
        })
      }
      break
    }

    case 'PROPORTIONAL': {
      basis =
        rule.basisAttribute === null
          ? ctx.chargeableValue
          : Money.of(readNonNegativeInteger(ctx.attributes, rule.basisAttribute), currency)
      raw = basis.multiplyPpm(rule.ratePpm, rule.rounding)
      ratePpm = rule.ratePpm
      appliedRules.push({
        code: 'PROPORTIONAL',
        detail:
          `${rule.ratePpm} ppm of ${basis.amountMinor} minor units` +
          (rule.basisAttribute === null ? '' : ` (basis attribute ${rule.basisAttribute})`),
      })
      break
    }

    case 'PROGRESSIVE_BANDS': {
      basis = ctx.chargeableValue
      const walked = walkBands(rule.bands, basis, rule.rounding)
      bands = walked.bands
      raw = walked.total
      appliedRules.push({
        code: 'PROGRESSIVE_BANDS',
        detail: `${rule.bands.length} marginal bands walked over ${basis.amountMinor} minor units`,
      })
      break
    }
  }

  // Round, then bound. Rounding first means a minimum is expressed in the
  // same granularity the pack rounds to (FR-7).
  const step = BigInt(rule.roundToStepMinor)
  const rounded = raw.roundTo(step, rule.rounding)
  if (rounded.amountMinor !== raw.amountMinor || step !== 1n) {
    appliedRules.push({
      code: 'ROUNDING',
      detail: `${rule.rounding} to a step of ${rule.roundToStepMinor} minor units`,
    })
  }

  const min = rule.minAmountMinor === null ? null : Money.of(BigInt(rule.minAmountMinor), currency)
  const max = rule.maxAmountMinor === null ? null : Money.of(BigInt(rule.maxAmountMinor), currency)
  const bounded = rounded.clamp(min, max)

  if (min !== null && bounded.amountMinor > rounded.amountMinor) {
    appliedRules.push({
      code: 'MIN_APPLIED',
      detail: `raised to the minimum of ${rule.minAmountMinor} minor units`,
    })
  }
  if (max !== null && bounded.amountMinor < rounded.amountMinor) {
    appliedRules.push({
      code: 'MAX_APPLIED',
      detail: `capped at the maximum of ${rule.maxAmountMinor} minor units`,
    })
  }

  return { amount: bounded, basis, ratePpm, bands, appliedRules }
}

interface WalkedBands {
  readonly bands: ComputedBand[]
  readonly total: Money
}

/**
 * Walk marginal bands. Each band charges only the slice of value that
 * falls inside it, so a bound is inclusive of its own band and exclusive
 * of the next.
 */
function walkBands(
  bands: readonly { upToMinor: string | null; ratePpm: number }[],
  basis: Money,
  rounding: Parameters<Money['multiplyPpm']>[1],
): WalkedBands {
  const currency = basis.currency
  const computed: ComputedBand[] = []
  const parts: Money[] = []
  let lowerBound = 0n

  for (const band of bands) {
    const upperBound = band.upToMinor === null ? basis.amountMinor : BigInt(band.upToMinor)
    const cappedUpper = upperBound < basis.amountMinor ? upperBound : basis.amountMinor
    const sliced = cappedUpper > lowerBound ? cappedUpper - lowerBound : 0n
    const sliceAmount = Money.of(sliced, currency).multiplyPpm(band.ratePpm, rounding)

    computed.push({
      fromMinor: lowerBound.toString(),
      toMinor: band.upToMinor,
      slicedMinor: sliced.toString(),
      ratePpm: band.ratePpm,
      amount: { amountMinor: sliceAmount.amountMinor.toString(), currency },
    })
    parts.push(sliceAmount)

    if (band.upToMinor !== null) lowerBound = BigInt(band.upToMinor)
  }

  return { bands: computed, total: Money.sum(parts, currency) }
}
