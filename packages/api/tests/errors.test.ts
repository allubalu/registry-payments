import { FeeInputError, InvalidMoneyWireError, UnknownCurrencyError } from '@registry/domain'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { UnknownJurisdictionError, errorHandler, toHttpError } from '../src/errors.ts'

describe('toHttpError', () => {
  it('maps a Zod failure to 400 with the offending paths', () => {
    const parsed = z.object({ a: z.string() }).safeParse({ a: 1 })
    if (parsed.success) throw new Error('fixture should not parse')

    const { status, body } = toHttpError(parsed.error)

    expect(status).toBe(400)
    expect(body.error).toBe('INVALID_REQUEST')
    expect(body.issues?.join(' ')).toContain('a')
  })

  it('maps an unknown jurisdiction to 404', () => {
    const { status, body } = toHttpError(new UnknownJurisdictionError('XX-ZZ'))

    expect(status).toBe(404)
    expect(body.error).toBe('UNKNOWN_JURISDICTION')
    expect(body.detail).toContain('XX-ZZ')
  })

  it('maps a malformed money payload to 400', () => {
    const { status, body } = toHttpError(new InvalidMoneyWireError('bad', 1))

    expect(status).toBe(400)
    expect(body.error).toBe('INVALID_MONEY')
  })

  it('maps an unknown currency to 400, not 422', () => {
    // An unrecognised currency code is a malformed value, not a rules decision.
    const { status, body } = toHttpError(new UnknownCurrencyError('XYZ'))

    expect(status).toBe(400)
    expect(body.error).toBe('INVALID_MONEY')
  })

  it('maps a domain fee-input rejection to 422', () => {
    const { status, body } = toHttpError(new FeeInputError('consideration must not be negative'))

    expect(status).toBe(422)
    expect(body.error).toBe('INVALID_FEE_INPUT')
    expect(body.detail).toContain('negative')
  })

  it('maps anything else to an opaque 500', () => {
    const { status, body } = toHttpError(new Error('db password is hunter2'))

    expect(status).toBe(500)
    expect(body.error).toBe('INTERNAL')
    expect(body.detail).not.toContain('hunter2')
  })

  it('maps a thrown non-Error to an opaque 500', () => {
    const { status, body } = toHttpError('just a string')

    expect(status).toBe(500)
    expect(body.detail).not.toContain('just a string')
  })
})

describe('errorHandler', () => {
  it('leaks neither the message nor a stack on an unexpected failure', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const app = express()
    app.get('/boom', () => {
      throw new Error('db password is hunter2')
    })
    app.use(errorHandler)

    const response = await request(app).get('/boom')

    expect(response.status).toBe(500)
    expect(response.text).not.toContain('hunter2')
    expect(response.text).not.toContain('at ')
    expect(response.body).toEqual({
      error: 'INTERNAL',
      detail: 'the server could not complete this request',
    })

    // The detail is not lost — it goes to stderr, not to the caller.
    expect(stderr).toHaveBeenCalled()
    expect(String(stderr.mock.calls[0]?.[0])).toContain('hunter2')
    stderr.mockRestore()
  })
})
