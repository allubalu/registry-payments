import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library auto-registers cleanup only when vitest `globals` is on.
// These suites import describe/it/expect explicitly, so it must be wired by
// hand — without it, mounted trees accumulate and every `getBy*` from the
// second test onward matches the previous test's DOM.
afterEach(cleanup)
