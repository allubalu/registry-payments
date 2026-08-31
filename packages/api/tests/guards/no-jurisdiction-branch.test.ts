import { describe, expect, it } from 'vitest'

import { readSourceFiles, stripComments } from './source-scan.ts'

/**
 * FR-1, extended past the engine to the two layers added by Plan 3.
 *
 * The domain proved that adding a jurisdiction needs no engine change. That
 * guarantee is worth nothing if the HTTP layer or the client reintroduces a
 * per-country branch — a `switch` on a pack id in a route, or a
 * `CaliforniaForm.tsx`. The whole point is that the API is generic over packs
 * and the client renders whatever `requiredAttributes` it is handed.
 *
 * Long ids are matched as substrings. 'JP' and 'SG' appear inside ordinary
 * tokens — 'JPY', 'SGD' — so they are matched only as whole quoted literals,
 * exactly as the domain's guard does.
 */
const PACK_IDS = ['IN-TG', 'GB-ENG', 'AE-DU', 'US-CA']

const QUOTED_SHORT_IDS = [/'JP'/, /"JP"/, /'SG'/, /"SG"/]

const SCANNED_DIRECTORIES = ['packages/api/src', 'packages/web/src']

describe('no jurisdiction-specific branching in the API or the client', () => {
  const sources = SCANNED_DIRECTORIES.flatMap((directory) => readSourceFiles(directory))

  it('finds both source trees, so a broken path cannot pass vacuously', () => {
    // Guards that read the filesystem fail open when the glob breaks. Assert
    // the corpus is real before asserting anything about its contents.
    expect(sources.length).toBeGreaterThan(8)
    expect(sources.some((file) => file.path.startsWith('packages/api/src'))).toBe(true)
    expect(sources.some((file) => file.path.startsWith('packages/web/src'))).toBe(true)
    expect(sources.some((file) => file.path.endsWith('.tsx'))).toBe(true)
  })

  for (const id of PACK_IDS) {
    it(`never names the jurisdiction "${id}"`, () => {
      const offenders = sources
        .filter((file) => stripComments(file.text).includes(id))
        .map((file) => file.path)

      expect(offenders).toEqual([])
    })
  }

  for (const pattern of QUOTED_SHORT_IDS) {
    it(`never uses the literal ${pattern.source}`, () => {
      const offenders = sources
        .filter((file) => pattern.test(stripComments(file.text)))
        .map((file) => file.path)

      expect(offenders).toEqual([])
    })
  }

  it('never names a country or region in code', () => {
    const forbidden = /\b(?:Telangana|England|Dubai|California|Singapore)\b/
    const offenders = sources
      .filter((file) => forbidden.test(stripComments(file.text)))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('never names a pack-specific attribute in code', () => {
    // The client must not know that England has a first-time-buyer question or
    // that California has counties. Those names arrive in requiredAttributes.
    const forbidden = /\b(?:firstTimeBuyer|documentCount|mortgaged|residency)\b/
    const offenders = sources
      .filter((file) => forbidden.test(stripComments(file.text)))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('has no per-jurisdiction component file', () => {
    const forbidden = /(?:Telangana|England|Dubai|California|Singapore|Japan)/i
    const offenders = sources.filter((file) => forbidden.test(file.path)).map((file) => file.path)

    expect(offenders).toEqual([])
  })
})
