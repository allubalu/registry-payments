import { DEFAULT_JURISDICTIONS_DIR, loadPackRegistry } from '@registry/domain'
import type { Express } from 'express'

import { createApp } from '../src/app.ts'

/**
 * The real registry over the real config directory, and the real app.
 *
 * Deliberately not a fixture: these tests assert against the same six packs the
 * server ships, so a pack edit that changes a fee is caught here as well as in
 * the domain's golden files.
 */
export function testApp(): Express {
  return createApp(loadPackRegistry(DEFAULT_JURISDICTIONS_DIR))
}

export const GB_ENG_FIRST_TIME_BUYER_BODY = {
  jurisdictionId: 'GB-ENG',
  propertyType: 'APARTMENT',
  transactionType: 'SALE',
  consideration: { amountMinor: '42500000', currency: 'GBP' },
  attributes: { firstTimeBuyer: true },
} as const
