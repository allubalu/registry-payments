import type { MoneyWire } from './money.ts'

/**
 * The wire contract, declared here rather than imported from `@registry/domain`.
 *
 * The client only ever sees JSON. Importing the domain's types would let a
 * `Money` instance or a `bigint` look reachable from the browser when it is not,
 * and would hide a contract break behind a shared type. These interfaces are
 * the honest description of what crosses the network.
 */

export type AttributeKind = 'string' | 'number' | 'boolean'
export type AttributeValue = string | number | boolean

export interface RequiredAttribute {
  readonly name: string
  readonly kind: AttributeKind
  readonly label: string
  readonly options: readonly string[] | null
}

export interface JurisdictionSummary {
  readonly id: string
  readonly jurisdictionLabel: string
  readonly currency: string
  readonly version: string
  readonly provenance: string
  readonly basisStrategy: string
  readonly requiredAttributes: readonly RequiredAttribute[]
}

export interface ComputedBand {
  readonly fromMinor: string
  readonly toMinor: string | null
  readonly slicedMinor: string
  readonly ratePpm: number
  readonly amount: MoneyWire
}

export interface AppliedRule {
  readonly code: string
  readonly detail: string
}

export interface ComputedComponent {
  readonly code: string
  readonly label: string
  readonly kind: string
  readonly applied: boolean
  readonly basis: MoneyWire | null
  readonly ratePpm: number | null
  readonly bands: readonly ComputedBand[] | null
  readonly amount: MoneyWire
  readonly appliedRules: readonly AppliedRule[]
}

export interface FeeBreakdown {
  readonly jurisdictionId: string
  readonly currency: string
  readonly chargeableValue: MoneyWire
  readonly basisStrategy: string
  readonly components: readonly ComputedComponent[]
  readonly total: MoneyWire
  readonly packId: string
  readonly packVersion: string
  readonly provenance: string
  readonly packSource: string | null
  readonly packRetrievedAt: string | null
  readonly disclaimer: string
}

export interface QuoteRequest {
  readonly jurisdictionId: string
  readonly propertyType: string
  readonly transactionType: string
  readonly consideration: MoneyWire
  readonly marketValue?: MoneyWire
  readonly attributes: Readonly<Record<string, AttributeValue>>
}

/** An error the API described. `detail` is safe to show a person. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly issues: readonly string[]

  constructor(status: number, code: string, detail: string, issues: readonly string[] = []) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.issues = issues
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body && 'detail' in body) {
      const shaped = body as { error: string; detail: string; issues?: readonly string[] }
      return new ApiError(response.status, shaped.error, shaped.detail, shaped.issues ?? [])
    }
  } catch {
    // Fall through: a non-JSON error body is still an error.
  }
  return new ApiError(response.status, 'UNKNOWN', `request failed with status ${response.status}`)
}

export async function fetchJurisdictions(): Promise<readonly JurisdictionSummary[]> {
  const response = await fetch('/api/jurisdictions')
  if (!response.ok) throw await toApiError(response)

  const body = (await response.json()) as { jurisdictions: readonly JurisdictionSummary[] }
  return body.jurisdictions
}

export async function postQuote(request: QuoteRequest): Promise<FeeBreakdown> {
  const response = await fetch('/api/fees/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw await toApiError(response)

  return (await response.json()) as FeeBreakdown
}
