import type { Money } from '../money/index.ts'
import type { AttributeValue, Condition } from './types.ts'

export interface ConditionContext {
  readonly attributes: Readonly<Record<string, AttributeValue>>
  readonly chargeableValue: Money
}

export class MissingAttributeError extends Error {
  readonly attribute: string

  constructor(attribute: string) {
    super(
      `Fee input is missing attribute "${attribute}", which a rule condition requires. ` +
        'A missing attribute is an error, never a false condition — silently dropping a ' +
        'fee component would under-charge a statutory fee.',
    )
    this.name = 'MissingAttributeError'
    this.attribute = attribute
  }
}

export class AttributeTypeError extends Error {
  readonly attribute: string

  constructor(attribute: string, expected: string, received: unknown) {
    super(
      `Attribute "${attribute}" must be a ${expected}, received ${typeof received} (${String(received)})`,
    )
    this.name = 'AttributeTypeError'
    this.attribute = attribute
  }
}

function readAttribute(ctx: ConditionContext, name: string): AttributeValue {
  if (!Object.hasOwn(ctx.attributes, name)) throw new MissingAttributeError(name)
  const value = ctx.attributes[name]
  if (value === undefined) throw new MissingAttributeError(name)
  return value
}

function readNumericAttribute(ctx: ConditionContext, name: string): number {
  const value = readAttribute(ctx, name)
  if (typeof value !== 'number') throw new AttributeTypeError(name, 'number', value)
  return value
}

export function evaluateCondition(condition: Condition, ctx: ConditionContext): boolean {
  switch (condition.op) {
    case 'always':
      return true
    case 'eq': {
      const value = readAttribute(ctx, condition.attribute)
      // Strict identity: no coercion, so "true" never equals true.
      return value === condition.value
    }
    case 'lte':
      return readNumericAttribute(ctx, condition.attribute) <= condition.value
    case 'gte':
      return readNumericAttribute(ctx, condition.attribute) >= condition.value
    case 'basisLte':
      return ctx.chargeableValue.amountMinor <= BigInt(condition.amountMinor)
    case 'basisGte':
      return ctx.chargeableValue.amountMinor >= BigInt(condition.amountMinor)
    case 'not':
      return !evaluateCondition(condition.of, ctx)
    case 'all':
      return condition.of.every((child) => evaluateCondition(child, ctx))
    case 'any':
      return condition.of.some((child) => evaluateCondition(child, ctx))
  }
}

function renderValue(value: AttributeValue): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

/** Human-readable rendering used in FeeBreakdown.appliedRules (FR-5). */
export function describeCondition(condition: Condition): string {
  switch (condition.op) {
    case 'always':
      return 'always applies'
    case 'eq':
      return `${condition.attribute} equals ${renderValue(condition.value)}`
    case 'lte':
      return `${condition.attribute} at most ${condition.value}`
    case 'gte':
      return `${condition.attribute} at least ${condition.value}`
    case 'basisLte':
      return `chargeable value at most ${condition.amountMinor} minor units`
    case 'basisGte':
      return `chargeable value at least ${condition.amountMinor} minor units`
    case 'not':
      return `not (${describeCondition(condition.of)})`
    case 'all':
      return `all of (${condition.of.map(describeCondition).join('; ')})`
    case 'any':
      return `any of (${condition.of.map(describeCondition).join('; ')})`
  }
}
