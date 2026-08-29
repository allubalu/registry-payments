import { z } from 'zod'
import { CURRENCIES } from '../money/index.ts'
import type { Condition, FeeComponentRule, JurisdictionRulePack } from './types.ts'

export class InvalidRulePackError extends Error {
  constructor(sourceLabel: string, detail: string) {
    super(`Invalid jurisdiction rule pack "${sourceLabel}": ${detail}`)
    this.name = 'InvalidRulePackError'
  }
}

const MinorAmountSchema = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative decimal integer string of minor units')

const RatePpmSchema = z
  .number()
  .int('ratePpm must be an integer number of parts-per-million')
  .min(0)
  .max(1_000_000)

const CurrencyCodeSchema = z.enum(
  Object.keys(CURRENCIES) as [keyof typeof CURRENCIES, ...Array<keyof typeof CURRENCIES>],
)

const RoundingModeSchema = z.enum(['HALF_UP', 'HALF_EVEN', 'CEIL', 'FLOOR'])

const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean()])

const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('always') }),
    z.strictObject({
      op: z.literal('eq'),
      attribute: z.string().min(1),
      value: AttributeValueSchema,
    }),
    z.strictObject({ op: z.literal('lte'), attribute: z.string().min(1), value: z.number() }),
    z.strictObject({ op: z.literal('gte'), attribute: z.string().min(1), value: z.number() }),
    z.strictObject({ op: z.literal('basisLte'), amountMinor: MinorAmountSchema }),
    z.strictObject({ op: z.literal('basisGte'), amountMinor: MinorAmountSchema }),
    z.strictObject({ op: z.literal('not'), of: ConditionSchema }),
    z.strictObject({ op: z.literal('all'), of: z.array(ConditionSchema).min(1) }),
    z.strictObject({ op: z.literal('any'), of: z.array(ConditionSchema).min(1) }),
  ]),
)

const componentBase = {
  code: z.string().min(1).regex(/^[A-Z0-9_]+$/, 'component code must be UPPER_SNAKE_CASE'),
  label: z.string().min(1),
  condition: ConditionSchema.default({ op: 'always' }),
  rounding: RoundingModeSchema.default('HALF_UP'),
  roundToStepMinor: MinorAmountSchema.refine((v) => v !== '0', 'step must be positive').default('1'),
  minAmountMinor: MinorAmountSchema.nullable().default(null),
  maxAmountMinor: MinorAmountSchema.nullable().default(null),
}

const BandSchema = z.strictObject({
  upToMinor: MinorAmountSchema.nullable(),
  ratePpm: RatePpmSchema,
})

const FlatRuleSchema = z.strictObject({
  ...componentBase,
  kind: z.literal('FLAT'),
  amountMinor: MinorAmountSchema,
  timesAttribute: z.string().min(1).nullable().default(null),
})

const ProportionalRuleSchema = z.strictObject({
  ...componentBase,
  kind: z.literal('PROPORTIONAL'),
  ratePpm: RatePpmSchema,
  basisAttribute: z.string().min(1).nullable().default(null),
})

const ProgressiveBandsRuleSchema = z
  .strictObject({
    ...componentBase,
    kind: z.literal('PROGRESSIVE_BANDS'),
    bands: z.array(BandSchema).min(1),
  })
  .superRefine((rule, ctx) => {
    let previous = -1n
    rule.bands.forEach((band, index) => {
      const isFinal = index === rule.bands.length - 1
      if (band.upToMinor === null) {
        if (!isFinal) {
          ctx.addIssue({
            code: 'custom',
            path: ['bands', index, 'upToMinor'],
            message: 'only the final band may be unbounded',
          })
        }
        return
      }
      if (isFinal) {
        ctx.addIssue({
          code: 'custom',
          path: ['bands', index, 'upToMinor'],
          message:
            'the final band must be unbounded (upToMinor null), otherwise value above it is never charged',
        })
      }
      const bound = BigInt(band.upToMinor)
      if (bound <= previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['bands', index, 'upToMinor'],
          message: 'band bounds must be strictly ascending',
        })
      }
      previous = bound
    })
  })

const ComponentSchema = z
  .discriminatedUnion('kind', [FlatRuleSchema, ProportionalRuleSchema, ProgressiveBandsRuleSchema])
  .superRefine((rule, ctx) => {
    if (
      rule.minAmountMinor !== null &&
      rule.maxAmountMinor !== null &&
      BigInt(rule.minAmountMinor) > BigInt(rule.maxAmountMinor)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['minAmountMinor'],
        message: `minAmountMinor ${rule.minAmountMinor} exceeds maxAmountMinor ${rule.maxAmountMinor}`,
      })
    }
  })

const RequiredAttributeSchema = z.strictObject({
  name: z.string().min(1),
  kind: z.enum(['string', 'number', 'boolean']),
  label: z.string().min(1),
  options: z.array(z.string().min(1)).nullable().default(null),
})

/** Every attribute name a condition tree references. */
function conditionAttributes(condition: Condition, into: Set<string>): void {
  switch (condition.op) {
    case 'eq':
    case 'lte':
    case 'gte':
      into.add(condition.attribute)
      return
    case 'not':
      conditionAttributes(condition.of, into)
      return
    case 'all':
    case 'any':
      for (const child of condition.of) conditionAttributes(child, into)
      return
    case 'always':
    case 'basisLte':
    case 'basisGte':
      return
  }
}

function componentAttributes(rule: FeeComponentRule, into: Set<string>): void {
  conditionAttributes(rule.condition, into)
  if (rule.kind === 'FLAT' && rule.timesAttribute !== null) into.add(rule.timesAttribute)
  if (rule.kind === 'PROPORTIONAL' && rule.basisAttribute !== null) into.add(rule.basisAttribute)
}

const RulePackSchema = z
  .strictObject({
    id: z.string().min(1).regex(/^[A-Z]{2}(-[A-Z]{2,4})?$/, 'id must be ISO 3166 based'),
    jurisdictionLabel: z.string().min(1),
    currency: CurrencyCodeSchema,
    version: z.string().min(1),
    timezone: z.string().min(1),
    provenance: z.enum(['SOURCED', 'SYNTHETIC']),
    packSource: z.string().url().nullable().default(null),
    packRetrievedAt: z.string().min(1).nullable().default(null),
    basisStrategy: z.enum([
      'MAX_OF_MARKET_AND_CONSIDERATION',
      'CONSIDERATION_ONLY',
      'MARKET_ONLY',
    ]),
    requiredAttributes: z.array(RequiredAttributeSchema).default([]),
    components: z.array(ComponentSchema).min(1, 'a pack must declare at least one component'),
  })
  .superRefine((pack, ctx) => {
    // FR-10: provenance is blocking. SOURCED demands a citation.
    if (pack.provenance === 'SOURCED') {
      if (pack.packSource === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['packSource'],
          message: 'a SOURCED pack requires packSource, a citation URL',
        })
      }
      if (pack.packRetrievedAt === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['packRetrievedAt'],
          message: 'a SOURCED pack requires packRetrievedAt',
        })
      }
    }

    const seen = new Set<string>()
    for (const component of pack.components) {
      if (seen.has(component.code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['components'],
          message: `duplicate component code "${component.code}"`,
        })
      }
      seen.add(component.code)
    }

    // Every attribute a component references must be declared, so form
    // generation and validation stay derivable from the pack alone (FR-2).
    const declared = new Set(pack.requiredAttributes.map((attribute) => attribute.name))
    const referenced = new Set<string>()
    for (const component of pack.components) {
      componentAttributes(component as FeeComponentRule, referenced)
    }
    for (const name of referenced) {
      if (!declared.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['requiredAttributes'],
          message: `component references attribute "${name}", which requiredAttributes does not declare`,
        })
      }
    }
  })

export const JurisdictionRulePackSchema =
  RulePackSchema as unknown as z.ZodType<JurisdictionRulePack>

export function parseRulePack(raw: unknown, sourceLabel: string): JurisdictionRulePack {
  const result = RulePackSchema.safeParse(raw)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new InvalidRulePackError(sourceLabel, detail)
  }
  return result.data as JurisdictionRulePack
}
