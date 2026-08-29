import { describe, expect, it } from 'vitest'
// tests/fees -> tests -> domain -> packages -> repo root, so four levels.
// The plan had three, which resolves to packages/tools.
import { parseArgs, parseAttribute, renderBreakdown } from '../../../../tools/quote.ts'
import { computeFee } from '../../src/fees/compute.ts'
import { DEFAULT_JURISDICTIONS_DIR, loadPackRegistry } from '../../src/fees/loader.ts'
import { Money } from '../../src/money/index.ts'

describe('parseAttribute', () => {
  it('parses a boolean', () => {
    expect(parseAttribute('firstTimeBuyer=true')).toEqual(['firstTimeBuyer', true])
    expect(parseAttribute('firstTimeBuyer=false')).toEqual(['firstTimeBuyer', false])
  })

  it('parses an integer', () => {
    expect(parseAttribute('documentCount=2')).toEqual(['documentCount', 2])
  })

  it('parses a string, including one with spaces', () => {
    expect(parseAttribute('county=Los Angeles')).toEqual(['county', 'Los Angeles'])
  })

  it('keeps a value containing = intact after the first separator', () => {
    expect(parseAttribute('note=a=b')).toEqual(['note', 'a=b'])
  })

  it('rejects a malformed pair', () => {
    expect(() => parseAttribute('county')).toThrow(/name=value/)
  })
})

describe('parseArgs', () => {
  it('parses a full quote invocation', () => {
    const parsed = parseArgs([
      '--jurisdiction',
      'US-CA',
      '--consideration',
      '85000000',
      '--attr',
      'county=Alameda',
      '--attr',
      'documentCount=2',
    ])
    expect(parsed).toMatchObject({
      mode: 'quote',
      jurisdictionId: 'US-CA',
      considerationMinor: '85000000',
      attributes: { county: 'Alameda', documentCount: 2 },
      json: false,
    })
  })

  it('defaults market value to the consideration when omitted', () => {
    const parsed = parseArgs(['--jurisdiction', 'JP', '--consideration', '60000000'])
    expect(parsed).toMatchObject({ marketValueMinor: '60000000' })
  })

  it('recognises --all', () => {
    expect(parseArgs(['--all']).mode).toBe('all')
  })

  it('recognises --json', () => {
    expect(parseArgs(['--all', '--json']).json).toBe(true)
  })

  it('rejects a quote with no jurisdiction', () => {
    expect(() => parseArgs(['--consideration', '1'])).toThrow(/--jurisdiction/)
  })

  it('rejects a quote with no consideration', () => {
    expect(() => parseArgs(['--jurisdiction', 'JP'])).toThrow(/--consideration/)
  })

  it('rejects a non-integer amount', () => {
    expect(() => parseArgs(['--jurisdiction', 'JP', '--consideration', '1.5'])).toThrow(/integer/i)
  })

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--all', '--verbose'])).toThrow(/--verbose/)
  })
})

describe('renderBreakdown', () => {
  const registry = loadPackRegistry(DEFAULT_JURISDICTIONS_DIR)
  const pack = registry.get('JP')
  const breakdown = computeFee(
    {
      jurisdictionId: 'JP',
      propertyType: 'APARTMENT',
      transactionType: 'SALE',
      consideration: Money.of(60000000n, 'JPY'),
      marketValue: Money.of(60000000n, 'JPY'),
      attributes: {},
    },
    pack,
  )

  it('shows the total with no decimals for yen', () => {
    const rendered = renderBreakdown(breakdown, pack)
    expect(rendered).toContain('1,250,000')
    expect(rendered).not.toMatch(/1,250,000\.\d/)
  })

  it('names every component', () => {
    const rendered = renderBreakdown(breakdown, pack)
    expect(rendered).toContain('Registration and licence tax')
    expect(rendered).toContain('Judicial scrivener fee')
  })

  it('always carries the synthetic warning', () => {
    expect(renderBreakdown(breakdown, pack)).toMatch(/synthetic|illustrative/i)
  })
})
