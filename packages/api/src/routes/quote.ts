import type { FeeInput, PackRegistry } from '@registry/domain'
import { computeFee, fromWire, validateFeeInput } from '@registry/domain'
import { Router } from 'express'

import { UnknownJurisdictionError } from '../errors.ts'
import { QuoteRequestSchema } from '../schemas.ts'

/**
 * Fee quoting over HTTP (FR-12): side-effect free and idempotent. Nothing is
 * persisted, so the same body always produces the same body.
 *
 * The response is the `FeeBreakdown` verbatim. There is no DTO and no mapping
 * layer, because `FeeBreakdown` already holds `MoneyWire` rather than `Money` —
 * it was built for this boundary.
 */
export function quoteRouter(registry: PackRegistry): Router {
  const router = Router()

  router.post('/quote', (request, response, next) => {
    try {
      const body = QuoteRequestSchema.parse(request.body)

      if (!registry.has(body.jurisdictionId)) {
        throw new UnknownJurisdictionError(body.jurisdictionId)
      }
      const pack = registry.get(body.jurisdictionId)

      const consideration = fromWire(body.consideration)
      const marketValue =
        body.marketValue === undefined ? consideration : fromWire(body.marketValue)

      const input: FeeInput = {
        jurisdictionId: body.jurisdictionId,
        propertyType: body.propertyType,
        transactionType: body.transactionType,
        consideration,
        marketValue,
        attributes: body.attributes,
      }

      // Called explicitly, even though computeFee calls it too, so the failure
      // is attributable to validation rather than to computation.
      validateFeeInput(input, pack)

      response.json(computeFee(input, pack))
    } catch (cause) {
      next(cause)
    }
  })

  return router
}
