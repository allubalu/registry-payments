import { describe, expect, it } from 'vitest'
import { readSourceFiles, stripComments } from './source-scan.ts'

/**
 * FR-1 and success criterion 3: the engine must contain no
 * jurisdiction-specific branching. Everything jurisdictional is data.
 *
 * loader.ts is exempt from the path check only in that it resolves the
 * pack DIRECTORY — it still may not name an individual jurisdiction.
 */
const PACK_IDS = ['IN-TG', 'GB-ENG', 'AE-DU', 'US-CA']

// 'JP' and 'SG' are two-letter tokens that appear inside ordinary words,
// so they are matched as whole quoted string literals only.
const QUOTED_SHORT_IDS = [/'JP'/, /"JP"/, /'SG'/, /"SG"/]

describe('no jurisdiction-specific branching in the fee engine', () => {
  const sources = readSourceFiles('src/fees')

  it('finds the engine source, so a broken glob cannot pass vacuously', () => {
    expect(sources.length).toBeGreaterThan(5)
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

  it('never names a country or currency symbol in engine logic', () => {
    const forbidden = /\b(?:Telangana|England|Dubai|California|Singapore)\b/
    const offenders = sources
      .filter((file) => forbidden.test(stripComments(file.text)))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })
})
