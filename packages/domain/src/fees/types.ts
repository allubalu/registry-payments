import type { CurrencyCode, Money, MoneyWire, RoundingMode } from '../money/index.ts'

export type PropertyType = 'LAND' | 'HOUSE' | 'APARTMENT' | 'COMMERCIAL'
export type TransactionType = 'SALE' | 'GIFT' | 'MORTGAGE' | 'LEASE'

/** How a pack decides the value the fees are charged on (FR-3). */
export type BasisStrategy =
  | 'MAX_OF_MARKET_AND_CONSIDERATION'
  | 'CONSIDERATION_ONLY'
  | 'MARKET_ONLY'

/** FR-10. There is no third state; an unmarked pack fails to load. */
export type Provenance = 'SOURCED' | 'SYNTHETIC'

export type AttributeValue = string | number | boolean

export type Condition =
  | { readonly op: 'always' }
  | { readonly op: 'eq'; readonly attribute: string; readonly value: AttributeValue }
  | { readonly op: 'lte'; readonly attribute: string; readonly value: number }
  | { readonly op: 'gte'; readonly attribute: string; readonly value: number }
  | { readonly op: 'basisLte'; readonly amountMinor: string }
  | { readonly op: 'basisGte'; readonly amountMinor: string }
  | { readonly op: 'not'; readonly of: Condition }
  | { readonly op: 'all'; readonly of: readonly Condition[] }
  | { readonly op: 'any'; readonly of: readonly Condition[] }

interface ComponentRuleBase {
  readonly code: string
  readonly label: string
  /** When this component applies. Defaults to always. */
  readonly condition: Condition
  readonly rounding: RoundingMode
  /**
   * Round to this many minor units. "1" means the currency's minor unit;
   * a pack that rounds duty up to the whole currency unit sets 10^exponent
   * with rounding CEIL.
   */
  readonly roundToStepMinor: string
  readonly minAmountMinor: string | null
  readonly maxAmountMinor: string | null
}

export interface FlatRule extends ComponentRuleBase {
  readonly kind: 'FLAT'
  readonly amountMinor: string
  /**
   * Multiply the flat amount by this numeric attribute. Per-document
   * recording fees use it; null means charge once.
   */
  readonly timesAttribute: string | null
}

export interface ProportionalRule extends ComponentRuleBase {
  readonly kind: 'PROPORTIONAL'
  /** Integer parts-per-million. 0.5% is 5000 (FR-6). */
  readonly ratePpm: number
  /**
   * Charge on a numeric attribute (in minor units) instead of the pack's
   * chargeable value. A mortgage registration fee charged on the loan
   * amount uses it; null means use the chargeable value.
   */
  readonly basisAttribute: string | null
}

export interface Band {
  /** Upper bound in minor units, inclusive. null means unbounded. */
  readonly upToMinor: string | null
  readonly ratePpm: number
}

export interface ProgressiveBandsRule extends ComponentRuleBase {
  readonly kind: 'PROGRESSIVE_BANDS'
  /** Ordered ascending. Each band charges only its own slice (marginal). */
  readonly bands: readonly Band[]
}

export type FeeComponentRule = FlatRule | ProportionalRule | ProgressiveBandsRule

export interface RequiredAttribute {
  readonly name: string
  readonly kind: 'string' | 'number' | 'boolean'
  readonly label: string
  /** Permitted values for a string attribute, or null for free text. */
  readonly options: readonly string[] | null
}

export interface JurisdictionRulePack {
  /** ISO 3166 based, e.g. "IN-TG", "GB-ENG", "US-CA", "SG". */
  readonly id: string
  readonly jurisdictionLabel: string
  readonly currency: CurrencyCode
  readonly version: string
  /** IANA zone, used for display and business-day logic only (NFR-8a). */
  readonly timezone: string
  readonly provenance: Provenance
  /** Citation URL. Required when provenance is SOURCED (FR-10). */
  readonly packSource: string | null
  readonly packRetrievedAt: string | null
  readonly basisStrategy: BasisStrategy
  /** Drives client form generation; validation is derived from this (FR-2). */
  readonly requiredAttributes: readonly RequiredAttribute[]
  readonly components: readonly FeeComponentRule[]
}

export interface FeeInput {
  readonly jurisdictionId: string
  readonly propertyType: PropertyType
  readonly transactionType: TransactionType
  readonly consideration: Money
  readonly marketValue: Money
  readonly attributes: Readonly<Record<string, AttributeValue>>
}

/** One human-readable statement of a rule the engine actually applied (FR-5). */
export interface AppliedRule {
  readonly code: string
  readonly detail: string
}

export interface ComputedBand {
  readonly fromMinor: string
  readonly toMinor: string | null
  readonly slicedMinor: string
  readonly ratePpm: number
  readonly amount: MoneyWire
}

export interface ComputedComponent {
  readonly code: string
  readonly label: string
  readonly kind: FeeComponentRule['kind']
  readonly applied: boolean
  /** The value this component was charged on, when it had one. */
  readonly basis: MoneyWire | null
  readonly ratePpm: number | null
  readonly bands: readonly ComputedBand[] | null
  readonly amount: MoneyWire
  readonly appliedRules: readonly AppliedRule[]
}

export interface FeeBreakdown {
  readonly jurisdictionId: string
  readonly currency: CurrencyCode
  readonly chargeableValue: MoneyWire
  readonly basisStrategy: BasisStrategy
  readonly components: readonly ComputedComponent[]
  readonly total: MoneyWire
  readonly packId: string
  readonly packVersion: string
  readonly provenance: Provenance
  readonly packSource: string | null
  readonly packRetrievedAt: string | null
  readonly disclaimer: string
}
