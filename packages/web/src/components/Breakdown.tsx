import type { ComputedComponent, FeeBreakdown } from '../api.ts'
import { formatMoney, formatRatePpm, minorToDecimalString } from '../money.ts'
import { ProvenanceBanner } from './ProvenanceBanner.tsx'

function BandRows({ component }: { readonly component: ComputedComponent }) {
  if (component.bands === null || component.bands.length === 0) return null

  return (
    <table className="bands">
      <thead>
        <tr>
          <th>Band</th>
          <th>Charged on</th>
          <th>Rate</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {component.bands.map((band, index) => (
          <tr key={`${band.fromMinor}-${index}`}>
            <td>
              {minorToDecimalString(band.fromMinor, component.amount.currency)}
              {' – '}
              {band.toMinor === null
                ? 'above'
                : minorToDecimalString(band.toMinor, component.amount.currency)}
            </td>
            <td>{formatMoney({ amountMinor: band.slicedMinor, currency: component.amount.currency })}</td>
            <td>{formatRatePpm(band.ratePpm)}</td>
            <td>{formatMoney(band.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ComponentRow({ component }: { readonly component: ComputedComponent }) {
  return (
    <li className={component.applied ? 'component' : 'component component--skipped'}>
      <div className="component__head">
        <span className="component__label">{component.label}</span>
        <span className="component__amount">
          {component.applied ? formatMoney(component.amount) : 'not applied'}
        </span>
      </div>

      {component.applied && component.ratePpm !== null && component.basis !== null && (
        <p className="component__detail">
          {formatRatePpm(component.ratePpm)} of {formatMoney(component.basis)}
        </p>
      )}

      {component.applied && <BandRows component={component} />}

      {component.appliedRules.length > 0 && (
        <ul className="rules">
          {component.appliedRules.map((rule) => (
            <li key={rule.code}>{rule.detail}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Renders a quote.
 *
 * Components that did not apply are shown, greyed, rather than filtered out.
 * *Why a relief did not fire* is usually the question a person actually has, and
 * a breakdown that silently omits the first-time-buyer line cannot answer it.
 */
export function Breakdown({ breakdown }: { readonly breakdown: FeeBreakdown }) {
  return (
    <section className="breakdown" aria-label="Fee breakdown">
      <dl className="breakdown__meta">
        <div>
          <dt>Chargeable value</dt>
          <dd>{formatMoney(breakdown.chargeableValue)}</dd>
        </div>
        <div>
          <dt>Basis</dt>
          <dd>{breakdown.basisStrategy}</dd>
        </div>
        <div>
          <dt>Rule pack</dt>
          <dd>
            {breakdown.packId} v{breakdown.packVersion}
          </dd>
        </div>
      </dl>

      <ul className="components">
        {breakdown.components.map((component) => (
          <ComponentRow key={component.code} component={component} />
        ))}
      </ul>

      <div className="total">
        <span>Total payable</span>
        <strong>{formatMoney(breakdown.total)}</strong>
      </div>

      <ProvenanceBanner provenance={breakdown.provenance} disclaimer={breakdown.disclaimer} />
    </section>
  )
}
