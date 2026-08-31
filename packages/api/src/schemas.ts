import { z } from 'zod'

/**
 * Money on the wire (FR-0d).
 *
 * `amountMinor` is `z.string()` with no coercion on purpose: a JSON number must
 * be rejected, not quietly accepted. Above 2^53 a JS number silently loses
 * precision, so accepting one would corrupt large considerations invisibly —
 * exactly the failure this project exists to make impossible.
 *
 * The pattern permits a leading minus. A negative consideration is a
 * well-formed money value that the *rules* reject, so it belongs to the domain
 * (422), not to shape parsing (400).
 */
export const MoneyWireSchema = z.object({
  amountMinor: z
    .string()
    .regex(/^-?\d+$/, 'must be a decimal integer string, with no decimal point or exponent'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter uppercase currency code'),
})

export const PropertyTypeSchema = z.enum(['LAND', 'HOUSE', 'APARTMENT', 'COMMERCIAL'])
export const TransactionTypeSchema = z.enum(['SALE', 'GIFT', 'MORTGAGE', 'LEASE'])

/** Pack-declared attributes are string | number | boolean (AttributeValue). */
export const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean()])

/**
 * A quote request. Shape only — which attributes a pack requires, and whether
 * the currency is the pack's, are decided by `validateFeeInput` so the two
 * cannot drift.
 *
 * `marketValue` is optional and defaults to `consideration`, matching the CLI,
 * so single-basis jurisdictions need not send the same figure twice.
 */
export const QuoteRequestSchema = z.object({
  jurisdictionId: z.string().min(1),
  propertyType: PropertyTypeSchema,
  transactionType: TransactionTypeSchema,
  consideration: MoneyWireSchema,
  marketValue: MoneyWireSchema.optional(),
  attributes: z.record(z.string(), AttributeValueSchema).default({}),
})

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>
