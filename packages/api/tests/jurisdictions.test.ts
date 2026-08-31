import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { testApp } from './helpers.ts'

describe('GET /api/health', () => {
  it('reports the number of loaded jurisdictions', async () => {
    const response = await request(testApp()).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', jurisdictions: 6 })
  })
})

describe('GET /api/jurisdictions', () => {
  it('returns all six packs', async () => {
    const response = await request(testApp()).get('/api/jurisdictions')

    expect(response.status).toBe(200)
    expect(response.body.jurisdictions).toHaveLength(6)
  })

  it('sorts by id so the picker order is stable', async () => {
    const response = await request(testApp()).get('/api/jurisdictions')

    const ids = response.body.jurisdictions.map((j: { id: string }) => j.id)
    expect(ids).toEqual(['AE-DU', 'GB-ENG', 'IN-TG', 'JP', 'SG', 'US-CA'])
  })

  it('carries currency, provenance and basis for every pack', async () => {
    const response = await request(testApp()).get('/api/jurisdictions')

    for (const jurisdiction of response.body.jurisdictions) {
      expect(jurisdiction.currency).toMatch(/^[A-Z]{3}$/)
      expect(jurisdiction.provenance).toBe('SYNTHETIC')
      expect(typeof jurisdiction.basisStrategy).toBe('string')
      expect(typeof jurisdiction.jurisdictionLabel).toBe('string')
    }
  })

  it('drives the client form: US-CA exposes county options and a numeric document count', async () => {
    const response = await request(testApp()).get('/api/jurisdictions')

    const california = response.body.jurisdictions.find((j: { id: string }) => j.id === 'US-CA')
    const county = california.requiredAttributes.find(
      (a: { name: string }) => a.name === 'county',
    )
    const documentCount = california.requiredAttributes.find(
      (a: { name: string }) => a.name === 'documentCount',
    )

    expect(county.kind).toBe('string')
    expect(county.options).toEqual(['Alameda', 'Los Angeles', 'San Diego'])
    expect(documentCount.kind).toBe('number')
    expect(documentCount.options).toBeNull()
  })

  it('reports an empty attribute list for packs that need none', async () => {
    const response = await request(testApp()).get('/api/jurisdictions')

    const japan = response.body.jurisdictions.find((j: { id: string }) => j.id === 'JP')
    expect(japan.requiredAttributes).toEqual([])
  })

  it('never leaks the rate schedule', async () => {
    // The client must not be able to compute a fee itself. Shipping `components`
    // would invite exactly that, and put a second engine in the browser.
    const response = await request(testApp()).get('/api/jurisdictions')

    expect(JSON.stringify(response.body)).not.toContain('ratePpm')
    for (const jurisdiction of response.body.jurisdictions) {
      expect(jurisdiction).not.toHaveProperty('components')
    }
  })
})
