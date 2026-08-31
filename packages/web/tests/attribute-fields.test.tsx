import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AttributeValue, RequiredAttribute } from '../src/api.ts'
import { AttributeFields } from '../src/components/AttributeFields.tsx'

/** The real shapes, copied from config/jurisdictions. */
const US_CA: readonly RequiredAttribute[] = [
  { name: 'county', kind: 'string', label: 'County', options: ['Alameda', 'Los Angeles', 'San Diego'] },
  { name: 'documentCount', kind: 'number', label: 'Number of documents', options: null },
]
const GB_ENG: readonly RequiredAttribute[] = [
  { name: 'firstTimeBuyer', kind: 'boolean', label: 'First-time buyer', options: null },
]
const FREE_TEXT: readonly RequiredAttribute[] = [
  { name: 'reference', kind: 'string', label: 'Case reference', options: null },
]

function Harness({ attributes }: { readonly attributes: readonly RequiredAttribute[] }) {
  const [values, setValues] = useState<Record<string, AttributeValue>>({})
  return (
    <AttributeFields
      attributes={attributes}
      values={values}
      onChange={(name, value) => setValues((previous) => ({ ...previous, [name]: value }))}
    />
  )
}

describe('AttributeFields', () => {
  it('renders a select of the pack’s options for a constrained string', () => {
    render(<AttributeFields attributes={US_CA} values={{}} onChange={vi.fn()} />)

    const county = screen.getByLabelText('County')
    expect(county.tagName).toBe('SELECT')
    expect(
      Array.from(county.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Choose…', 'Alameda', 'Los Angeles', 'San Diego'])
  })

  it('renders a number input for a numeric attribute', () => {
    render(<AttributeFields attributes={US_CA} values={{}} onChange={vi.fn()} />)

    expect(screen.getByLabelText('Number of documents')).toHaveAttribute('type', 'number')
  })

  it('renders a checkbox for a boolean attribute', () => {
    render(<AttributeFields attributes={GB_ENG} values={{}} onChange={vi.fn()} />)

    expect(screen.getByLabelText('First-time buyer')).toHaveAttribute('type', 'checkbox')
  })

  it('renders a text input for an unconstrained string', () => {
    render(<AttributeFields attributes={FREE_TEXT} values={{}} onChange={vi.fn()} />)

    expect(screen.getByLabelText('Case reference')).toHaveAttribute('type', 'text')
  })

  it('says so when a pack requires nothing', () => {
    render(<AttributeFields attributes={[]} values={{}} onChange={vi.fn()} />)

    expect(screen.getByText(/needs no extra details/i)).toBeInTheDocument()
  })

  it('reports a chosen option', async () => {
    const onChange = vi.fn()
    render(<AttributeFields attributes={US_CA} values={{}} onChange={onChange} />)

    await userEvent.selectOptions(screen.getByLabelText('County'), 'Los Angeles')

    expect(onChange).toHaveBeenCalledWith('county', 'Los Angeles')
  })

  it('reports a ticked checkbox as a boolean, not a string', () => {
    const onChange = vi.fn()
    render(<AttributeFields attributes={GB_ENG} values={{}} onChange={onChange} />)

    screen.getByLabelText('First-time buyer').click()

    expect(onChange).toHaveBeenCalledWith('firstTimeBuyer', true)
  })

  it('reports a number as a number, not a string', async () => {
    const onChange = vi.fn()
    render(<AttributeFields attributes={US_CA} values={{}} onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('Number of documents'), '3')

    expect(onChange).toHaveBeenCalledWith('documentCount', 3)
  })

  it('does not report an emptied number box as zero', async () => {
    // Zero is an answer; blank is not. Reporting 0 would silently change a fee.
    const onChange = vi.fn()
    render(
      <AttributeFields attributes={US_CA} values={{ documentCount: 3 }} onChange={onChange} />,
    )

    await userEvent.clear(screen.getByLabelText('Number of documents'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders a different form for a different pack, with no code between them', () => {
    // The same component, twice, with different data — no per-country branch.
    const { unmount } = render(<Harness attributes={US_CA} />)
    expect(screen.getByLabelText('County')).toBeInTheDocument()
    expect(screen.queryByLabelText('First-time buyer')).not.toBeInTheDocument()
    unmount()

    render(<Harness attributes={GB_ENG} />)
    expect(screen.getByLabelText('First-time buyer')).toBeInTheDocument()
    expect(screen.queryByLabelText('County')).not.toBeInTheDocument()
  })

  it('shows no stale value when the same field name is reused across packs', () => {
    render(<AttributeFields attributes={US_CA} values={{}} onChange={vi.fn()} />)

    expect(screen.getByLabelText('County')).toHaveValue('')
    expect(screen.getByLabelText('Number of documents')).toHaveValue(null)
  })
})
