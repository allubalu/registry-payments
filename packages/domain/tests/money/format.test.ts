import { describe, expect, it } from 'vitest'
import { formatMoney } from '../../src/money/format.ts'
import { Money } from '../../src/money/money.ts'

/** Intl separator code points vary by ICU version; compare on plain spaces. */
const normalise = (value: string) => value.replace(/[  ]/g, ' ')

describe('formatMoney', () => {
  it('shows two decimals for a two-exponent currency', () => {
    expect(normalise(formatMoney(Money.of(650000n, 'GBP')))).toBe('£6,500.00')
  })

  it('shows NO decimals for yen, because JPY has no minor unit', () => {
    const formatted = normalise(formatMoney(Money.of(1250000n, 'JPY')))
    expect(formatted).toContain('1,250,000')
    expect(formatted).not.toContain('.')
  })

  it('shows three decimals for a three-exponent currency', () => {
    // Locale forced to en-US: ar-KW would render Arabic-Indic digits, which
    // is correct for that locale but tests ICU rather than the exponent.
    expect(normalise(formatMoney(Money.of(1234n, 'KWD'), { locale: 'en-US' }))).toMatch(
      /1\.234/,
    )
  })

  it('uses Indian grouping for rupees', () => {
    // 30020000 paise = 3,00,200.00 rupees in the lakh convention
    expect(normalise(formatMoney(Money.of(30020000n, 'INR')))).toContain('3,00,200.00')
  })

  it('groups US dollars in thousands', () => {
    expect(normalise(formatMoney(Money.of(493000n, 'USD')))).toBe('$4,930.00')
  })

  it('formats a negative amount', () => {
    expect(normalise(formatMoney(Money.of(-650000n, 'GBP')))).toMatch(/6,500\.00/)
    expect(normalise(formatMoney(Money.of(-650000n, 'GBP')))).toMatch(/-|\(/)
  })

  it('formats zero', () => {
    expect(normalise(formatMoney(Money.zero('GBP')))).toBe('£0.00')
  })

  it('omits the symbol when asked, for table columns that carry their own header', () => {
    const formatted = normalise(formatMoney(Money.of(650000n, 'GBP'), { withSymbol: false }))
    expect(formatted).toBe('6,500.00')
  })

  it('honours an explicit locale override', () => {
    const formatted = normalise(formatMoney(Money.of(650000n, 'GBP'), { locale: 'de-DE' }))
    expect(formatted).toContain('6.500,00')
  })

  it('is exact for a very large amount, with no float drift', () => {
    // 9007199254740993 exceeds Number.MAX_SAFE_INTEGER by 2
    const formatted = normalise(formatMoney(Money.of(9007199254740993n, 'JPY')))
    expect(formatted).toContain('9,007,199,254,740,993')
  })

  it('is exact for a large two-exponent amount, where a float would drift', () => {
    // 90071992547409.93 in major units — the fractional part is the tell
    const formatted = normalise(
      formatMoney(Money.of(9007199254740993n, 'USD'), { withSymbol: false }),
    )
    expect(formatted).toBe('90,071,992,547,409.93')
  })
})
