#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_JURISDICTIONS_DIR,
  type AttributeValue,
  type FeeBreakdown,
  type JurisdictionRulePack,
  type MoneyWire,
  type PropertyType,
  type TransactionType,
  Money,
  computeFee,
  formatMoney,
  fromWire,
  loadPackRegistry,
} from '../packages/domain/src/index.ts'

// tools/ -> the repo root, so one level up, not two. The plan had
// ../../config, which resolves outside this repo entirely.
const FIXTURES_DIR = fileURLToPath(new URL('../config/fixtures/', import.meta.url))

export interface ParsedArgs {
  readonly mode: 'quote' | 'all'
  readonly jurisdictionId: string | null
  readonly considerationMinor: string | null
  readonly marketValueMinor: string | null
  readonly propertyType: PropertyType
  readonly transactionType: TransactionType
  readonly attributes: Record<string, AttributeValue>
  readonly json: boolean
}

const AMOUNT_PATTERN = /^\d+$/

export function parseAttribute(pair: string): [string, AttributeValue] {
  const separator = pair.indexOf('=')
  if (separator <= 0) {
    throw new Error(`--attr expects name=value, received "${pair}"`)
  }
  const name = pair.slice(0, separator)
  const raw = pair.slice(separator + 1)

  if (raw === 'true') return [name, true]
  if (raw === 'false') return [name, false]
  if (/^-?\d+$/.test(raw)) return [name, Number(raw)]
  return [name, raw]
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let mode: 'quote' | 'all' = 'quote'
  let jurisdictionId: string | null = null
  let considerationMinor: string | null = null
  let marketValueMinor: string | null = null
  let propertyType: PropertyType = 'APARTMENT'
  let transactionType: TransactionType = 'SALE'
  let json = false
  const attributes: Record<string, AttributeValue> = {}

  const requireValue = (flag: string, value: string | undefined): string => {
    if (value === undefined) throw new Error(`${flag} requires a value`)
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    switch (flag) {
      case '--all':
        mode = 'all'
        break
      case '--json':
        json = true
        break
      case '--jurisdiction':
        jurisdictionId = requireValue(flag, argv[++index])
        break
      case '--consideration':
        considerationMinor = requireValue(flag, argv[++index])
        break
      case '--market':
        marketValueMinor = requireValue(flag, argv[++index])
        break
      case '--property-type':
        propertyType = requireValue(flag, argv[++index]) as PropertyType
        break
      case '--transaction-type':
        transactionType = requireValue(flag, argv[++index]) as TransactionType
        break
      case '--attr': {
        const [name, value] = parseAttribute(requireValue(flag, argv[++index]))
        attributes[name] = value
        break
      }
      default:
        throw new Error(`Unknown argument "${flag}"`)
    }
  }

  if (mode === 'quote') {
    if (jurisdictionId === null) throw new Error('--jurisdiction is required')
    if (considerationMinor === null) throw new Error('--consideration is required')
  }
  for (const [flag, value] of [
    ['--consideration', considerationMinor],
    ['--market', marketValueMinor],
  ] as const) {
    if (value !== null && !AMOUNT_PATTERN.test(value)) {
      throw new Error(`${flag} must be a non-negative integer of minor units, received "${value}"`)
    }
  }

  return {
    mode,
    jurisdictionId,
    considerationMinor,
    // Defaulting market value to consideration keeps single-basis
    // jurisdictions terse; MAX_OF_... packs need both to differ.
    marketValueMinor: marketValueMinor ?? considerationMinor,
    propertyType,
    transactionType,
    attributes,
    json,
  }
}

export function renderBreakdown(breakdown: FeeBreakdown, pack: JurisdictionRulePack): string {
  const lines: string[] = []
  const money = (wire: MoneyWire) => formatMoney(fromWire(wire))

  lines.push('')
  lines.push(`${pack.jurisdictionLabel}  ·  ${pack.id} ${pack.version}  ·  ${pack.currency}`)
  lines.push('─'.repeat(72))
  lines.push(`Chargeable value   ${money(breakdown.chargeableValue)}`)
  lines.push(`Basis              ${breakdown.basisStrategy}`)
  lines.push('')

  for (const component of breakdown.components) {
    if (!component.applied) {
      lines.push(`  ${component.label.padEnd(46)} ${'—'.padStart(18)}   not applied`)
      continue
    }
    const rate = component.ratePpm === null ? '' : `  ${component.ratePpm / 10000}%`
    lines.push(`  ${(component.label + rate).padEnd(46)} ${money(component.amount).padStart(18)}`)

    if (component.bands !== null) {
      for (const band of component.bands) {
        if (band.slicedMinor === '0') continue
        const upper = band.toMinor === null ? 'above' : band.toMinor
        lines.push(
          `      band ${band.fromMinor}–${upper} on ${band.slicedMinor} at ` +
            `${band.ratePpm / 10000}%  ${money(band.amount)}`,
        )
      }
    }
  }

  lines.push('─'.repeat(72))
  lines.push(`  ${'TOTAL PAYABLE'.padEnd(46)} ${money(breakdown.total).padStart(18)}`)
  lines.push('')
  lines.push(`  ⚠  ${breakdown.disclaimer}`)
  lines.push(`     Provenance: ${breakdown.provenance}`)
  lines.push('')

  return lines.join('\n')
}

interface FixtureFile {
  readonly cases: readonly {
    readonly name: string
    readonly input: {
      readonly propertyType: PropertyType
      readonly transactionType: TransactionType
      readonly considerationMinor: string
      readonly marketValueMinor: string
      readonly attributes: Record<string, AttributeValue>
    }
  }[]
}

const USAGE =
  'Usage:\n' +
  '  quote --all [--json]\n' +
  '  quote --jurisdiction <id> --consideration <minor> [--market <minor>]\n' +
  '        [--attr name=value ...] [--property-type T] [--transaction-type T] [--json]\n'

function main(argv: readonly string[]): number {
  let args: ParsedArgs
  try {
    args = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`)
    process.stderr.write(USAGE)
    return 2
  }

  try {
    return run(args)
  } catch (error) {
    // Every error reachable here — PackRegistryError, InvalidRulePackError,
    // FeeInputError, MissingAttributeError — carries a message written to be
    // read by a person, naming the pack, the attribute, or the jurisdictions
    // that ARE loaded. Letting it reach the top level replaces all of that
    // with a Node stack trace.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function run(args: ParsedArgs): number {
  const registry = loadPackRegistry(DEFAULT_JURISDICTIONS_DIR)
  const breakdowns: FeeBreakdown[] = []

  if (args.mode === 'all') {
    for (const pack of registry.all()) {
      const fixture = JSON.parse(
        readFileSync(join(FIXTURES_DIR, `${pack.id}.golden.json`), 'utf8'),
      ) as FixtureFile
      const first = fixture.cases[0]
      if (first === undefined) continue
      breakdowns.push(
        computeFee(
          {
            jurisdictionId: pack.id,
            propertyType: first.input.propertyType,
            transactionType: first.input.transactionType,
            consideration: Money.of(BigInt(first.input.considerationMinor), pack.currency),
            marketValue: Money.of(BigInt(first.input.marketValueMinor), pack.currency),
            attributes: first.input.attributes,
          },
          pack,
        ),
      )
    }
  } else {
    const pack = registry.get(args.jurisdictionId as string)
    breakdowns.push(
      computeFee(
        {
          jurisdictionId: pack.id,
          propertyType: args.propertyType,
          transactionType: args.transactionType,
          consideration: Money.of(BigInt(args.considerationMinor as string), pack.currency),
          marketValue: Money.of(BigInt(args.marketValueMinor as string), pack.currency),
          attributes: args.attributes,
        },
        pack,
      ),
    )
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(breakdowns, null, 2)}\n`)
  } else {
    for (const breakdown of breakdowns) {
      process.stdout.write(renderBreakdown(breakdown, registry.get(breakdown.packId)))
    }
  }
  return 0
}

// Only run when invoked directly, so the test can import the parsers.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  process.exitCode = main(process.argv.slice(2))
}
