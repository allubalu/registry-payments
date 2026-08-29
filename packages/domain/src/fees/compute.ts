import { Money, toWire } from '../money/index.ts'
import { resolveChargeableValue } from './basis.ts'
import { computeComponent } from './components.ts'
import { describeCondition } from './condition.ts'
import type {
  ComputedComponent,
  FeeBreakdown,
  FeeInput,
  JurisdictionRulePack,
} from './types.ts'

export const SYNTHETIC_DISCLAIMER =
  'Illustrative rates for demonstration only — not this jurisdiction’s actual ' +
  'fees, and not an official assessment.'

export const SOURCED_DISCLAIMER =
  'Computed from published rates. Demonstration computation, not an official assessment.'

export class FeeInputError extends Error {
  constructor(detail: string) {
    super(`Invalid fee input: ${detail}`)
    this.name = 'FeeInputError'
  }
}

/**
 * Check an input against a pack before computing.
 *
 * Exported so the HTTP layer can reject a bad request with a 400 before
 * any computation happens; computeFee calls it too, so the engine is never
 * reachable with an invalid input.
 */
export function validateFeeInput(input: FeeInput, pack: JurisdictionRulePack): void {
  if (input.jurisdictionId !== pack.id) {
    throw new FeeInputError(
      `input names jurisdiction "${input.jurisdictionId}" but the pack is "${pack.id}"`,
    )
  }
  if (input.consideration.currency !== pack.currency) {
    throw new FeeInputError(
      `consideration is in ${input.consideration.currency} but pack ${pack.id} charges in ${pack.currency}`,
    )
  }
  if (input.marketValue.currency !== pack.currency) {
    throw new FeeInputError(
      `marketValue is in ${input.marketValue.currency} but pack ${pack.id} charges in ${pack.currency}`,
    )
  }
  if (input.consideration.isNegative()) {
    throw new FeeInputError('consideration must not be negative')
  }
  if (input.marketValue.isNegative()) {
    throw new FeeInputError('marketValue must not be negative')
  }

  // Validation is driven entirely by the pack's declaration, so adding a
  // jurisdiction needs no engine change (FR-2).
  for (const attribute of pack.requiredAttributes) {
    if (!Object.hasOwn(input.attributes, attribute.name)) {
      throw new FeeInputError(
        `pack ${pack.id} requires attribute "${attribute.name}" (${attribute.label}), which is missing`,
      )
    }
    const value = input.attributes[attribute.name]
    if (typeof value !== attribute.kind) {
      throw new FeeInputError(
        `attribute "${attribute.name}" must be a ${attribute.kind}, received ${typeof value}`,
      )
    }
    if (
      attribute.options !== null &&
      typeof value === 'string' &&
      !attribute.options.includes(value)
    ) {
      throw new FeeInputError(
        `attribute "${attribute.name}" value "${value}" is not one of: ${attribute.options.join(', ')}`,
      )
    }
  }
}

/**
 * Compute a fully self-explaining fee breakdown (FR-1, FR-5).
 *
 * Pure: no I/O, no clock, no randomness, and no branching on a
 * jurisdiction id. Everything jurisdiction-specific comes from the pack.
 */
export function computeFee(input: FeeInput, pack: JurisdictionRulePack): FeeBreakdown {
  validateFeeInput(input, pack)

  const chargeableValue = resolveChargeableValue(input, pack.basisStrategy)
  const ctx = { chargeableValue, attributes: input.attributes }

  const components: ComputedComponent[] = []
  const applicableAmounts: Money[] = []

  for (const rule of pack.components) {
    const computed = computeComponent(rule, ctx)

    if (computed === null) {
      // Listed but not applied, so a citizen can see the rule exists and
      // why it did not fire. Zero-amount, but distinct from "applied and
      // worth nothing".
      components.push({
        code: rule.code,
        label: rule.label,
        kind: rule.kind,
        applied: false,
        basis: null,
        ratePpm: null,
        bands: null,
        amount: { amountMinor: '0', currency: pack.currency },
        appliedRules: [
          {
            code: 'NOT_APPLIED',
            detail: `not applied: condition requires ${describeCondition(rule.condition)}`,
          },
        ],
      })
      continue
    }

    components.push({
      code: rule.code,
      label: rule.label,
      kind: rule.kind,
      applied: true,
      basis: computed.basis === null ? null : toWire(computed.basis),
      ratePpm: computed.ratePpm,
      bands: computed.bands,
      amount: toWire(computed.amount),
      appliedRules: computed.appliedRules,
    })
    applicableAmounts.push(computed.amount)
  }

  // Components are rounded individually then summed; never summed then
  // rounded (FR-7).
  const total = Money.sum(applicableAmounts, pack.currency)

  return {
    jurisdictionId: pack.id,
    currency: pack.currency,
    chargeableValue: toWire(chargeableValue),
    basisStrategy: pack.basisStrategy,
    components,
    total: toWire(total),
    packId: pack.id,
    packVersion: pack.version,
    provenance: pack.provenance,
    packSource: pack.packSource,
    packRetrievedAt: pack.packRetrievedAt,
    disclaimer: pack.provenance === 'SYNTHETIC' ? SYNTHETIC_DISCLAIMER : SOURCED_DISCLAIMER,
  }
}
