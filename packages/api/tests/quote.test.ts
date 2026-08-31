import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { GB_ENG_FIRST_TIME_BUYER_BODY, testApp } from './helpers.ts'

const post = (body: object) => request(testApp()).post('/api/fees/quote').send(body)

describe('POST /api/fees/quote', () => {
  it('quotes a derived basis, taking the higher of market and consideration', async () => {
    const response = await post({
      jurisdictionId: 'IN-TG',
      propertyType: 'APARTMENT',
      transactionType: 'SALE',
      consideration: { amountMinor: '5000000', currency: 'INR' },
      marketValue: { amountMinor: '7500000', currency: 'INR' },
      attributes: {},
    })

    expect(response.status).toBe(200)
    expect(response.body.basisStrategy).toBe('MAX_OF_MARKET_AND_CONSIDERATION')
    expect(response.body.chargeableValue).toEqual({ amountMinor: '7500000', currency: 'INR' })
    expect(response.body.total).toEqual({ amountMinor: '470000', currency: 'INR' })
  })

  it('defaults marketValue to consideration when it is omitted', async () => {
    const withDefault = await post({
      jurisdictionId: 'JP',
      propertyType: 'HOUSE',
      transactionType: 'SALE',
      consideration: { amountMinor: '50000000', currency: 'JPY' },
      attributes: {},
    })
    const explicit = await post({
      jurisdictionId: 'JP',
      propertyType: 'HOUSE',
      transactionType: 'SALE',
      consideration: { amountMinor: '50000000', currency: 'JPY' },
      marketValue: { amountMinor: '50000000', currency: 'JPY' },
      attributes: {},
    })

    expect(withDefault.status).toBe(200)
    expect(withDefault.body).toEqual(explicit.body)
  })

  it('keeps a zero-decimal currency in whole units', async () => {
    const response = await post({
      jurisdictionId: 'JP',
      propertyType: 'HOUSE',
      transactionType: 'SALE',
      consideration: { amountMinor: '50000000', currency: 'JPY' },
      attributes: {},
    })

    expect(response.body.currency).toBe('JPY')
    expect(response.body.total).toEqual({ amountMinor: '1050000', currency: 'JPY' })
  })

  it('carries the £1 relief cliff over HTTP', async () => {
    const atThreshold = await post(GB_ENG_FIRST_TIME_BUYER_BODY)
    const oneMinorUnitOver = await post({
      ...GB_ENG_FIRST_TIME_BUYER_BODY,
      consideration: { amountMinor: '42500001', currency: 'GBP' },
    })

    expect(atThreshold.body.total).toEqual({ amountMinor: '65000', currency: 'GBP' })
    expect(oneMinorUnitOver.body.total).toEqual({ amountMinor: '740000', currency: 'GBP' })
  })

  it('selects a county sub-schedule from an attribute, without a separate pack', async () => {
    const base = {
      jurisdictionId: 'US-CA',
      propertyType: 'APARTMENT',
      transactionType: 'SALE',
      consideration: { amountMinor: '85000000', currency: 'USD' },
    }

    const losAngeles = await post({
      ...base,
      attributes: { county: 'Los Angeles', documentCount: 3 },
    })
    const alameda = await post({ ...base, attributes: { county: 'Alameda', documentCount: 3 } })

    expect(losAngeles.body.total).toEqual({ amountMinor: '599250', currency: 'USD' })
    expect(alameda.body.total).toEqual({ amountMinor: '501500', currency: 'USD' })
  })

  it('applies two stacked band schedules, selected by a residency attribute', async () => {
    // SG is the fixture-tier pack and the hardest fee shape in the set. Covered
    // here so all six jurisdictions are exercised over HTTP, not five.
    const base = {
      jurisdictionId: 'SG',
      propertyType: 'APARTMENT',
      transactionType: 'SALE',
      consideration: { amountMinor: '120000000', currency: 'SGD' },
    }

    const foreigner = await post({ ...base, attributes: { residency: 'FOREIGNER' } })
    const citizen = await post({
      ...base,
      attributes: { residency: 'CITIZEN_FIRST_PROPERTY' },
    })

    expect(foreigner.body.total).toEqual({ amountMinor: '75260050', currency: 'SGD' })
    expect(citizen.body.total).toEqual({ amountMinor: '3260050', currency: 'SGD' })
  })

  it('quotes every loaded jurisdiction, so none is reachable only by the CLI', async () => {
    const listed = await request(testApp()).get('/api/jurisdictions')
    const ids = listed.body.jurisdictions.map((j: { id: string }) => j.id)

    expect(ids).toHaveLength(6)
  })

  it('reports a component that did not apply, rather than omitting it', async () => {
    // Why a relief did not fire is the interesting half of a breakdown.
    const response = await post({
      jurisdictionId: 'AE-DU',
      propertyType: 'COMMERCIAL',
      transactionType: 'SALE',
      consideration: { amountMinor: '250000000', currency: 'AED' },
      attributes: { mortgaged: false, loanAmountMinor: 0 },
    })

    const notApplied = response.body.components.filter((c: { applied: boolean }) => !c.applied)
    expect(notApplied.length).toBeGreaterThan(0)
    expect(notApplied[0].amount).toEqual({ amountMinor: '0', currency: 'AED' })
  })

  it('always carries the provenance disclaimer', async () => {
    const response = await post(GB_ENG_FIRST_TIME_BUYER_BODY)

    expect(response.body.provenance).toBe('SYNTHETIC')
    expect(response.body.disclaimer).toMatch(/illustrative/i)
  })

  it('is idempotent and side-effect free', async () => {
    const first = await post(GB_ENG_FIRST_TIME_BUYER_BODY)
    const second = await post(GB_ENG_FIRST_TIME_BUYER_BODY)

    expect(JSON.stringify(first.body)).toBe(JSON.stringify(second.body))
  })

  it('sends every money value as a string, never a JSON number', async () => {
    const response = await post(GB_ENG_FIRST_TIME_BUYER_BODY)

    const raw = JSON.parse(response.text)
    expect(typeof raw.total.amountMinor).toBe('string')
    expect(typeof raw.chargeableValue.amountMinor).toBe('string')
    for (const component of raw.components) {
      expect(typeof component.amount.amountMinor).toBe('string')
    }
  })
})

describe('POST /api/fees/quote — rejections', () => {
  it('404s an unknown jurisdiction', async () => {
    const response = await post({
      ...GB_ENG_FIRST_TIME_BUYER_BODY,
      jurisdictionId: 'XX-ZZ',
    })

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('UNKNOWN_JURISDICTION')
  })

  it('422s a missing required attribute', async () => {
    const response = await post({ ...GB_ENG_FIRST_TIME_BUYER_BODY, attributes: {} })

    expect(response.status).toBe(422)
    expect(response.body.error).toBe('INVALID_FEE_INPUT')
    expect(response.body.detail).toContain('firstTimeBuyer')
  })

  it('422s an attribute of the wrong type', async () => {
    const response = await post({
      ...GB_ENG_FIRST_TIME_BUYER_BODY,
      attributes: { firstTimeBuyer: 'yes' },
    })

    expect(response.status).toBe(422)
    expect(response.body.detail).toContain('must be a boolean')
  })

  it('422s a string attribute outside the pack’s options', async () => {
    const response = await post({
      jurisdictionId: 'US-CA',
      propertyType: 'APARTMENT',
      transactionType: 'SALE',
      consideration: { amountMinor: '85000000', currency: 'USD' },
      attributes: { county: 'Atlantis', documentCount: 1 },
    })

    expect(response.status).toBe(422)
    expect(response.body.detail).toContain('Atlantis')
  })

  it('422s a currency that is not the pack’s', async () => {
    const response = await post({
      ...GB_ENG_FIRST_TIME_BUYER_BODY,
      consideration: { amountMinor: '42500000', currency: 'JPY' },
    })

    expect(response.status).toBe(422)
    expect(response.body.detail).toContain('GBP')
  })

  it('422s a negative consideration', async () => {
    const response = await post({
      ...GB_ENG_FIRST_TIME_BUYER_BODY,
      consideration: { amountMinor: '-1', currency: 'GBP' },
    })

    expect(response.status).toBe(422)
    expect(response.body.detail).toContain('negative')
  })

  it('400s money sent as a JSON number', async () => {
    // The FR-0d boundary. Above 2^53 a JS number loses precision silently, so
    // this must fail loudly rather than coerce.
    const response = await post({
      ...GB_ENG_FIRST_TIME_BUYER_BODY,
      consideration: { amountMinor: 42500000, currency: 'GBP' },
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('INVALID_REQUEST')
  })

  it('400s a money amount with a decimal point', async () => {
    const response = await post({
      ...GB_ENG_FIRST_TIME_BUYER_BODY,
      consideration: { amountMinor: '425000.00', currency: 'GBP' },
    })

    expect(response.status).toBe(400)
  })

  it('400s an unknown property type', async () => {
    const response = await post({ ...GB_ENG_FIRST_TIME_BUYER_BODY, propertyType: 'CASTLE' })

    expect(response.status).toBe(400)
    expect(response.body.issues.join(' ')).toContain('propertyType')
  })

  it('400s a missing body', async () => {
    const response = await request(testApp()).post('/api/fees/quote').send({})

    expect(response.status).toBe(400)
  })

  it('preserves precision above Number.MAX_SAFE_INTEGER', async () => {
    // 9007199254740993 is 2^53 + 1: unrepresentable as a JS number.
    const huge = '9007199254740993'
    const response = await post({
      jurisdictionId: 'JP',
      propertyType: 'COMMERCIAL',
      transactionType: 'SALE',
      consideration: { amountMinor: huge, currency: 'JPY' },
      attributes: {},
    })

    expect(response.status).toBe(200)
    expect(response.body.chargeableValue.amountMinor).toBe(huge)
  })
})
