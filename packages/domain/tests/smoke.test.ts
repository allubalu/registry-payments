import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME } from '../src/index.ts'

describe('domain package', () => {
  it('exposes its name', () => {
    expect(PACKAGE_NAME).toBe('@registry/domain')
  })
})
