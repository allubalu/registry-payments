import { DEFAULT_JURISDICTIONS_DIR, loadPackRegistry } from '@registry/domain'

import { createApp } from './app.ts'

const port = Number(process.env['PORT'] ?? 4000)

// Loading happens here, before the app exists. A pack that fails validation —
// an unmarked provenance, a malformed band — takes the process down instead of
// producing a server that serves five jurisdictions and lies about the sixth.
const registry = loadPackRegistry(DEFAULT_JURISDICTIONS_DIR)

createApp(registry).listen(port, () => {
  process.stdout.write(`[api] listening on http://localhost:${port}\n`)
  process.stdout.write(
    `[api] ${registry.ids().length} jurisdictions: ${registry.ids().join(', ')}\n`,
  )
})
