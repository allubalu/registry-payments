import { describe, expect, it } from 'vitest'
import { readSourceFiles, stripComments } from './source-scan.ts'

/**
 * Money is exact integer arithmetic on bigint. These patterns are how
 * float arithmetic gets into a money path (NFR-1, success criterion 11).
 *
 * money.ts and rounding.ts are the only files permitted to do integer
 * arithmetic on a minor amount at all — everything else must go through
 * the Money methods.
 */
const ARITHMETIC_ALLOWED_IN = new Set(['src/money/money.ts', 'src/money/rounding.ts'])

const FORBIDDEN = [
  {
    name: 'Number() applied to a minor amount',
    pattern: /Number\s*\(\s*[\w.]*amountMinor/,
  },
  {
    name: 'parseFloat or parseInt on a minor amount',
    pattern: /parse(?:Float|Int)\s*\(\s*[\w.]*amountMinor/,
  },
  {
    name: 'a hardcoded divide-or-multiply by 100, instead of the currency exponent',
    pattern: /amountMinor\s*\)?\s*[/*]\s*100\b|\b100\s*[/*]\s*[\w.]*amountMinor/,
  },
  {
    name: 'a float literal in a money or rate context',
    pattern: /(?:amountMinor|ratePpm)\s*[-+*/]\s*\d+\.\d+/,
  },
  {
    name: 'Math.round, Math.floor or Math.ceil on money — use divideRounded',
    pattern: /Math\.(?:round|floor|ceil)\s*\(\s*[\w.]*(?:amountMinor|Minor)\b/,
  },
]

describe('no float arithmetic on money', () => {
  const sources = readSourceFiles('src')

  it('finds source files to scan, so a broken glob cannot pass vacuously', () => {
    expect(sources.length).toBeGreaterThan(4)
  })

  for (const { name, pattern } of FORBIDDEN) {
    it(`has no ${name}`, () => {
      const offenders = sources
        .filter((file) => pattern.test(stripComments(file.text)))
        .map((file) => file.path)
      expect(offenders).toEqual([])
    })
  }

  it('does bare arithmetic on a minor amount only inside the money primitives', () => {
    const offenders = sources
      .filter((file) => !ARITHMETIC_ALLOWED_IN.has(file.path))
      .filter((file) => /amountMinor\s*\)?\s*[-+*/]\s*(?!\s*$)/.test(stripComments(file.text)))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })
})
