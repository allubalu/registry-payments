import { describe, expect, it } from 'vitest'

import {
  InvalidAmountError,
  formatMoney,
  formatRatePpm,
  fractionDigits,
  majorToMinorUnits,
  minorToDecimalString,
} from '../src/money.ts'

describe('fractionDigits', () => {
  it.each([
    ['GBP', 2],
    ['USD', 2],
    ['INR', 2],
    ['AED', 2],
    ['SGD', 2],
    ['JPY', 0],
    ['BHD', 3],
  ])('reports %s as %i places', (currency, expected) => {
    expect(fractionDigits(currency)).toBe(expected)
  })
})

describe('minorToDecimalString', () => {
  it('places the point per currency, never by dividing by 100', () => {
    expect(minorToDecimalString('42500000', 'GBP')).toBe('425000.00')
    expect(minorToDecimalString('50000000', 'JPY')).toBe('50000000')
    expect(minorToDecimalString('1234', 'BHD')).toBe('1.234')
  })

  it('pads amounts smaller than one major unit', () => {
    expect(minorToDecimalString('5', 'GBP')).toBe('0.05')
    expect(minorToDecimalString('0', 'GBP')).toBe('0.00')
  })

  it('keeps the sign', () => {
    expect(minorToDecimalString('-250', 'USD')).toBe('-2.50')
  })

  it('preserves precision above Number.MAX_SAFE_INTEGER', () => {
    // 2^53 + 1. Any implementation routing through a JS number returns
    // ...0992 or ...0994 here.
    expect(minorToDecimalString('9007199254740993', 'JPY')).toBe('9007199254740993')
    expect(minorToDecimalString('900719925474099399', 'GBP')).toBe('9007199254740993.99')
  })
})

describe('formatMoney', () => {
  it('formats a zero-decimal currency without decimals', () => {
    expect(formatMoney({ amountMinor: '1050000', currency: 'JPY' }, 'en-GB')).not.toContain('.')
  })

  it('formats a two-decimal currency with two', () => {
    expect(formatMoney({ amountMinor: '65000', currency: 'GBP' }, 'en-GB')).toBe('£650.00')
  })

  it('formats a three-decimal currency with three', () => {
    expect(formatMoney({ amountMinor: '1234', currency: 'BHD' }, 'en-GB')).toContain('1.234')
  })

  it('formats an amount too large for a JS number without corrupting it', () => {
    const formatted = formatMoney({ amountMinor: '900719925474099399', currency: 'GBP' }, 'en-GB')

    expect(formatted).toBe('£9,007,199,254,740,993.99')
  })
})

describe('formatRatePpm', () => {
  it('renders parts-per-million as a percentage', () => {
    expect(formatRatePpm(5000)).toBe('0.5%')
    expect(formatRatePpm(40000)).toBe('4%')
    expect(formatRatePpm(0)).toBe('0%')
  })
})

describe('majorToMinorUnits', () => {
  it('scales by the currency exponent', () => {
    expect(majorToMinorUnits('425000', 'GBP')).toBe('42500000')
    expect(majorToMinorUnits('425000.50', 'GBP')).toBe('42500050')
    expect(majorToMinorUnits('50000000', 'JPY')).toBe('50000000')
    expect(majorToMinorUnits('1.234', 'BHD')).toBe('1234')
  })

  it('pads a short fraction', () => {
    expect(majorToMinorUnits('425000.5', 'GBP')).toBe('42500050')
  })

  it('tolerates thousands separators and stray spaces', () => {
    expect(majorToMinorUnits('425,000.00', 'GBP')).toBe('42500000')
    expect(majorToMinorUnits(' 425000 ', 'GBP')).toBe('42500000')
  })

  it('survives a value beyond Number.MAX_SAFE_INTEGER', () => {
    expect(majorToMinorUnits('9007199254740993.99', 'GBP')).toBe('900719925474099399')
  })

  it('rejects more decimals than the currency has', () => {
    expect(() => majorToMinorUnits('425000.005', 'GBP')).toThrow(InvalidAmountError)
    expect(() => majorToMinorUnits('500.5', 'JPY')).toThrow(/no minor units/)
  })

  it('rejects an empty or non-numeric amount', () => {
    expect(() => majorToMinorUnits('', 'GBP')).toThrow(InvalidAmountError)
    expect(() => majorToMinorUnits('   ', 'GBP')).toThrow(InvalidAmountError)
    expect(() => majorToMinorUnits('abc', 'GBP')).toThrow(InvalidAmountError)
    expect(() => majorToMinorUnits('1.2.3', 'GBP')).toThrow(InvalidAmountError)
  })

  it('round-trips through the formatter', () => {
    const minor = majorToMinorUnits('425000.50', 'GBP')

    expect(formatMoney({ amountMinor: minor, currency: 'GBP' }, 'en-GB')).toBe('£425,000.50')
  })
})
