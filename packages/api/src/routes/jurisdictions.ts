import type { JurisdictionRulePack, PackRegistry } from '@registry/domain'
import { Router } from 'express'

/**
 * What the client needs to render a form and label a quote — and nothing more.
 *
 * `components` is deliberately absent. That is the rate schedule; the client has
 * no business holding it, and shipping it would invite a client-side fee
 * calculation, which is the one thing the architecture forbids. The client asks
 * the server what something costs.
 */
export interface JurisdictionSummary {
  readonly id: string
  readonly jurisdictionLabel: string
  readonly currency: string
  readonly version: string
  readonly provenance: string
  readonly basisStrategy: string
  readonly requiredAttributes: JurisdictionRulePack['requiredAttributes']
}

function summarise(pack: JurisdictionRulePack): JurisdictionSummary {
  return {
    id: pack.id,
    jurisdictionLabel: pack.jurisdictionLabel,
    currency: pack.currency,
    version: pack.version,
    provenance: pack.provenance,
    basisStrategy: pack.basisStrategy,
    requiredAttributes: pack.requiredAttributes,
  }
}

export function jurisdictionsRouter(registry: PackRegistry): Router {
  const router = Router()

  // Sorted by id so the picker order is stable across restarts, regardless of
  // the order the loader happened to read the directory in.
  router.get('/', (_request, response) => {
    const jurisdictions = registry
      .all()
      .map(summarise)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

    response.json({ jurisdictions })
  })

  return router
}
