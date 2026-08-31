import type { PackRegistry } from '@registry/domain'
import express, { type Express } from 'express'

import { errorHandler } from './errors.ts'
import { jurisdictionsRouter } from './routes/jurisdictions.ts'
import { quoteRouter } from './routes/quote.ts'

/**
 * Builds the application over an already-loaded pack registry.
 *
 * Takes the registry rather than loading it, and never calls `listen`: the port
 * belongs to `server.ts`, so every test can run the real app in-process with no
 * socket to clean up. Loading also stays where boot failures belong — a pack
 * that fails validation must take the process down, not a request.
 */
export function createApp(registry: PackRegistry): Express {
  const app = express()

  app.use(express.json({ limit: '64kb' }))

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', jurisdictions: registry.ids().length })
  })

  app.use('/api/jurisdictions', jurisdictionsRouter(registry))
  app.use('/api/fees', quoteRouter(registry))

  app.use(errorHandler)

  return app
}
