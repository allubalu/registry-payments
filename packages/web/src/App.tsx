import { useEffect, useMemo, useState } from 'react'

import {
  ApiError,
  type AttributeValue,
  type FeeBreakdown,
  type JurisdictionSummary,
  fetchJurisdictions,
  postQuote,
} from './api.ts'
import { AttributeFields } from './components/AttributeFields.tsx'
import { Breakdown } from './components/Breakdown.tsx'
import { JurisdictionPicker } from './components/JurisdictionPicker.tsx'
import { InvalidAmountError, fractionDigits, majorToMinorUnits } from './money.ts'

const PROPERTY_TYPES = ['LAND', 'HOUSE', 'APARTMENT', 'COMMERCIAL'] as const
const TRANSACTION_TYPES = ['SALE', 'GIFT', 'MORTGAGE', 'LEASE'] as const

export function App() {
  const [jurisdictions, setJurisdictions] = useState<readonly JurisdictionSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const [consideration, setConsideration] = useState('')
  const [marketValue, setMarketValue] = useState('')
  const [propertyType, setPropertyType] = useState<string>('APARTMENT')
  const [transactionType, setTransactionType] = useState<string>('SALE')
  const [attributes, setAttributes] = useState<Record<string, AttributeValue>>({})

  const [breakdown, setBreakdown] = useState<FeeBreakdown | null>(null)
  const [quoteError, setQuoteError] = useState<ApiError | InvalidAmountError | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetchJurisdictions()
      .then((loaded) => {
        if (cancelled) return
        setJurisdictions(loaded)
        setSelectedId(loaded[0]?.id ?? '')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setLoadError(
          cause instanceof Error ? cause.message : 'could not reach the fee service',
        )
      })

    return () => {
      cancelled = true
    }
  }, [])

  const selected = useMemo(
    () => jurisdictions.find((jurisdiction) => jurisdiction.id === selectedId) ?? null,
    [jurisdictions, selectedId],
  )

  /**
   * Attribute names do not carry across packs — `county` means nothing to the
   * England pack — so changing jurisdiction clears them rather than sending a
   * stale key to a pack that never declared it.
   */
  function selectJurisdiction(id: string) {
    setSelectedId(id)
    setAttributes({})
    setBreakdown(null)
    setQuoteError(null)
  }

  function setAttribute(name: string, value: AttributeValue) {
    setAttributes((previous) => ({ ...previous, [name]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (selected === null) return

    setPending(true)
    setQuoteError(null)

    try {
      const considerationWire = {
        amountMinor: majorToMinorUnits(consideration, selected.currency),
        currency: selected.currency,
      }

      const quoted = await postQuote({
        jurisdictionId: selected.id,
        propertyType,
        transactionType,
        consideration: considerationWire,
        // Sent only when given, so single-basis packs need not repeat the figure.
        ...(marketValue.trim() === ''
          ? {}
          : {
              marketValue: {
                amountMinor: majorToMinorUnits(marketValue, selected.currency),
                currency: selected.currency,
              },
            }),
        attributes,
      })

      setBreakdown(quoted)
    } catch (cause) {
      setBreakdown(null)
      setQuoteError(
        cause instanceof ApiError || cause instanceof InvalidAmountError
          ? cause
          : new ApiError(0, 'NETWORK', 'could not reach the fee service'),
      )
    } finally {
      setPending(false)
    }
  }

  if (loadError !== null) {
    return (
      <main className="shell">
        <h1>Property registration fees</h1>
        <p className="error">
          {loadError}. Is the API running on port 4000? Start it with{' '}
          <code>npm run dev:api</code>.
        </p>
      </main>
    )
  }

  if (selected === null) {
    return (
      <main className="shell">
        <h1>Property registration fees</h1>
        <p className="field-note">Loading jurisdictions…</p>
      </main>
    )
  }

  const decimals = fractionDigits(selected.currency)

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Property registration fees</h1>
        <p>
          Six jurisdictions, one fee engine. Every field below this picker is
          declared by a rule pack, not by a form built for a country.
        </p>
      </header>

      <div className="columns">
        <form className="panel" onSubmit={submit}>
          <JurisdictionPicker
            jurisdictions={jurisdictions}
            selectedId={selectedId}
            onSelect={selectJurisdiction}
          />

          <div className="field">
            <label htmlFor="consideration">Consideration ({selected.currency})</label>
            <input
              id="consideration"
              inputMode="decimal"
              placeholder={decimals === 0 ? 'e.g. 50000000' : 'e.g. 425000.00'}
              value={consideration}
              onChange={(event) => setConsideration(event.target.value)}
              required
            />
            <p className="field-note">
              {decimals === 0
                ? `${selected.currency} has no minor units — whole amounts only.`
                : `${decimals} decimal places.`}
            </p>
          </div>

          <div className="field">
            <label htmlFor="market">Market value ({selected.currency}, optional)</label>
            <input
              id="market"
              inputMode="decimal"
              placeholder="defaults to the consideration"
              value={marketValue}
              onChange={(event) => setMarketValue(event.target.value)}
            />
            <p className="field-note">Basis: {selected.basisStrategy}</p>
          </div>

          <div className="field">
            <label htmlFor="propertyType">Property type</label>
            <select
              id="propertyType"
              value={propertyType}
              onChange={(event) => setPropertyType(event.target.value)}
            >
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="transactionType">Transaction type</label>
            <select
              id="transactionType"
              value={transactionType}
              onChange={(event) => setTransactionType(event.target.value)}
            >
              {TRANSACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="pack-fields">
            <legend>Required by {selected.id}</legend>
            <AttributeFields
              attributes={selected.requiredAttributes}
              values={attributes}
              onChange={setAttribute}
            />
          </fieldset>

          <button type="submit" disabled={pending}>
            {pending ? 'Quoting…' : 'Quote this fee'}
          </button>

          {quoteError !== null && (
            <div className="error" role="alert">
              <p>{quoteError.message}</p>
              {quoteError instanceof ApiError && quoteError.issues.length > 0 && (
                <ul>
                  {quoteError.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>

        <div className="panel panel--result">
          {breakdown === null ? (
            <p className="field-note">
              Enter a consideration and quote to see an itemised breakdown.
            </p>
          ) : (
            <Breakdown breakdown={breakdown} />
          )}
        </div>
      </div>
    </main>
  )
}
