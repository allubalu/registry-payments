import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { FeeBreakdown } from '../src/api.ts'
import { Breakdown } from '../src/components/Breakdown.tsx'

/** Shaped like a real GB-ENG response, including the relief that did not fire. */
const GB_ENG_BREAKDOWN: FeeBreakdown = {
  jurisdictionId: 'GB-ENG',
  currency: 'GBP',
  chargeableValue: { amountMinor: '42500001', currency: 'GBP' },
  basisStrategy: 'CONSIDERATION_ONLY',
  components: [
    {
      code: 'transfer_duty',
      label: 'Transfer duty',
      kind: 'PROGRESSIVE_BANDS',
      applied: true,
      basis: { amountMinor: '42500001', currency: 'GBP' },
      ratePpm: null,
      bands: [
        {
          fromMinor: '0',
          toMinor: '15000000',
          slicedMinor: '15000000',
          ratePpm: 0,
          amount: { amountMinor: '0', currency: 'GBP' },
        },
        {
          fromMinor: '30000000',
          toMinor: null,
          slicedMinor: '12500001',
          ratePpm: 30000,
          amount: { amountMinor: '375000', currency: 'GBP' },
        },
      ],
      amount: { amountMinor: '675000', currency: 'GBP' },
      appliedRules: [{ code: 'bands', detail: 'Charged across 3 marginal bands' }],
    },
    {
      code: 'ftb_relief',
      label: 'Transfer duty — first-time buyer relief',
      kind: 'PROGRESSIVE_BANDS',
      applied: false,
      basis: null,
      ratePpm: null,
      bands: null,
      amount: { amountMinor: '0', currency: 'GBP' },
      appliedRules: [],
    },
  ],
  total: { amountMinor: '740000', currency: 'GBP' },
  packId: 'GB-ENG',
  packVersion: '2026.1',
  provenance: 'SYNTHETIC',
  packSource: null,
  packRetrievedAt: null,
  disclaimer: 'Illustrative rates for demonstration only — not an official assessment.',
}

describe('Breakdown', () => {
  it('shows the total formatted for the currency', () => {
    render(<Breakdown breakdown={GB_ENG_BREAKDOWN} />)

    expect(screen.getByText('£7,400.00')).toBeInTheDocument()
  })

  it('shows the chargeable value and basis', () => {
    render(<Breakdown breakdown={GB_ENG_BREAKDOWN} />)

    expect(screen.getByText('£425,000.01')).toBeInTheDocument()
    expect(screen.getByText('CONSIDERATION_ONLY')).toBeInTheDocument()
  })

  it('names the rule pack and version', () => {
    render(<Breakdown breakdown={GB_ENG_BREAKDOWN} />)

    expect(screen.getByText('GB-ENG v2026.1')).toBeInTheDocument()
  })

  it('shows a component that did not apply, rather than hiding it', () => {
    // Why the relief did not fire is the question a person actually has.
    render(<Breakdown breakdown={GB_ENG_BREAKDOWN} />)

    expect(screen.getByText(/first-time buyer relief/i)).toBeInTheDocument()
    expect(screen.getByText('not applied')).toBeInTheDocument()
  })

  it('renders the marginal bands with rates and sliced amounts', () => {
    render(<Breakdown breakdown={GB_ENG_BREAKDOWN} />)

    expect(screen.getByText('3%')).toBeInTheDocument()
    expect(screen.getByText('£125,000.01')).toBeInTheDocument()
    expect(screen.getByText('0.00 – 150000.00')).toBeInTheDocument()
    expect(screen.getByText('300000.00 – above')).toBeInTheDocument()
  })

  it('lists the rules the engine actually applied', () => {
    render(<Breakdown breakdown={GB_ENG_BREAKDOWN} />)

    expect(screen.getByText('Charged across 3 marginal bands')).toBeInTheDocument()
  })

  it('shows the provenance disclaimer next to the number', () => {
    render(<Breakdown breakdown={GB_ENG_BREAKDOWN} />)

    expect(screen.getByRole('note')).toHaveTextContent(/illustrative rates/i)
    expect(screen.getByRole('note')).toHaveTextContent('Provenance: SYNTHETIC')
  })

  it('formats a zero-decimal currency with no decimal point', () => {
    render(
      <Breakdown
        breakdown={{
          ...GB_ENG_BREAKDOWN,
          currency: 'JPY',
          chargeableValue: { amountMinor: '50000000', currency: 'JPY' },
          components: [],
          total: { amountMinor: '1050000', currency: 'JPY' },
        }}
      />,
    )

    const total = screen.getByText(/1,050,000/)
    expect(total.textContent).not.toContain('.')
  })
})
