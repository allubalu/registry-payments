# Money and Fee Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, I/O-free domain core of the property registration payment service — an exact-integer `Money` type, a jurisdiction-pluggable fee engine, and six versioned rule packs — proven by a CLI that quotes all six jurisdictions correctly.

**Architecture:** One npm workspace package, `packages/domain`, containing only pure functions over plain data: no database, no HTTP, no clock, no gateway. Money is an integer-minor-unit value object that throws on cross-currency arithmetic. Fee rules live entirely in versioned JSON files under `config/jurisdictions/`, validated by Zod at load time; the engine reads a pack and applies named strategies, never branching on a jurisdiction id. Later plans add `packages/server` and `packages/web` alongside this package without restructuring it.

**Tech Stack:** TypeScript ~6.0 (strict), Node 24, npm workspaces, Zod 4, Vitest 3, oxlint. No runtime dependencies beyond Zod.

**Spec:** `docs/superpowers/specs/2026-08-25-property-registration-payments-prd.md` — sections §4.0 (Money and currency), §4.1 (Fee calculation engine), §7 (Testing strategy, unit tier), and milestones M0, M1, M2.

**Scope boundary:** This plan implements FR-0a through FR-0e and FR-1 through FR-12. It does NOT implement persistence, auth, HTTP, payments, or UI — those are plans 2 through 6. A reviewer should reject any task in this plan that introduces a database call, a network call, `Date.now()`, or `Math.random()` into `packages/domain/src`.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **Package manager is npm.** The repo already uses `package-lock.json` (`grpc-streaming/frontend`). Never introduce pnpm or yarn.
- **Linter is oxlint**, matching `grpc-streaming/frontend/.oxlintrc.json`. Never introduce eslint.
- **TypeScript `strict: true`**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride`. No `any` in committed code; no `@ts-expect-error` without a comment naming the reason.
- **FR-0a — Money is a value object, never a number.** There is no bare numeric money type. Arithmetic on two `Money` values of different currencies throws.
- **FR-0b — Minor units are per-currency, never assumed to be 2.** `INR`/`GBP`/`SGD`/`AED`/`USD` = 2, `JPY` = 0, `KWD`/`BHD` = 3. Hardcoding "divide by 100" anywhere is a defect.
- **FR-0d — Money crosses any boundary as `{ amountMinor: string, currency: string }`.** JSON has no BigInt. Never a JS `Number`.
- **FR-6 — Rates are integer parts-per-million (`ratePpm`).** `0.5%` = `5000`. `4%` = `40000`. Never floating-point percentages.
- **FR-7 — Rounding is explicit and per-component**, specified by the rule pack (`HALF_UP | HALF_EVEN | CEIL | FLOOR`). Components are rounded individually **then** summed; never summed then rounded.
- **FR-10 — Provenance is blocking.** A pack declares `SOURCED` (requires non-null `packSource` and `packRetrievedAt`) or `SYNTHETIC`. There is no third state; an unmarked pack fails to load. All six packs shipped by this plan are `SYNTHETIC`.
- **FR-1 — No jurisdiction-specific branching in the engine.** A `grep` for any pack id (`IN-TG`, `GB-ENG`, `JP`, `AE-DU`, `US-CA`, `SG`) inside `packages/domain/src/fees/` must return nothing. This is enforced by a test in Task 12.
- **NFR-11 — Deterministic tests.** No clock, no randomness, no I/O in domain code.
- **Commit style:** Conventional Commits (`feat:`, `test:`, `chore:`, `fix:`). The repo has **zero commits on `master`**; Task 1 creates the initial commit.

---

## File Structure

Files that change together live together. The `money/` and `fees/` directories are separate because they have distinct responsibilities and distinct test suites: `money` knows nothing about fees, and `fees` consumes `money` through its public interface only.

```
payment-gateway/
  package.json                          npm workspace root, scripts: lint test build
  tsconfig.base.json                    shared compiler options, extended by each package
  .gitignore                            node_modules, dist, coverage
  README.md                             what this is, how to run it

  packages/domain/
    package.json                        name @registry/domain, zod dep, vitest devDep
    tsconfig.json                       extends ../../tsconfig.base.json
    vitest.config.ts
    src/
      money/
        currency.ts                     CurrencyCode, CURRENCIES registry, minorUnitExponent
        rounding.ts                     RoundingMode, divideRounded, roundToStep
        money.ts                        Money class, CurrencyMismatchError
        format.ts                       formatMoney via Intl (presentation only)
        wire.ts                         toWire / fromWire, the string DTO codec
        index.ts                        public surface of the money module
      fees/
        types.ts                        FeeInput, FeeBreakdown, component + pack types
        schema.ts                       Zod schemas, provenance guard
        condition.ts                    evaluateCondition over attributes
        basis.ts                        resolveChargeableValue, the basis strategies
        components.ts                   computeFlat, computeProportional, computeBands
        compute.ts                      computeFee orchestration, appliedRules assembly
        loader.ts                        loadPack, loadAllPacks, validateFeeInput
        index.ts                        public surface of the fees module
      index.ts                          package entry, re-exports money + fees
    tests/
      money/currency.test.ts
      money/rounding.test.ts
      money/money.test.ts
      money/format.test.ts
      money/wire.test.ts
      fees/condition.test.ts
      fees/basis.test.ts
      fees/components.test.ts
      fees/compute.test.ts
      fees/loader.test.ts
      fees/packs.golden.test.ts         auto-discovers every pack, fails if fixtures missing
      guards/no-float-money.test.ts     source scan: no arithmetic on amountMinor
      guards/no-jurisdiction-branch.test.ts  source scan: no pack id inside fees/

  config/
    jurisdictions/
      IN-TG-2026.1.json
      GB-ENG-2026.1.json
      JP-2026.1.json
      AE-DU-2026.1.json
      US-CA-2026.1.json
      SG-2026.1.json
    fixtures/
      IN-TG.golden.json
      GB-ENG.golden.json
      JP.golden.json
      AE-DU.golden.json
      US-CA.golden.json
      SG.golden.json

  tools/
    quote.ts                            CLI: quote one jurisdiction, or --all

  .github/workflows/ci.yml              npm ci, lint, test on push and PR
```

**Why the guard tests are their own directory:** they assert properties of the *source text*, not of runtime behaviour. Keeping them in `tests/guards/` stops a future reader from mistaking them for unit tests of a module and deleting them as redundant.

---

## Task 1: Workspace skeleton and CI

This task folds in every piece of setup the rest of the plan needs — workspace config, TypeScript, test runner, linter, CI, and the repository's first commit. It ends with a deliverable a reviewer can gate: `npm test` runs, passes one real assertion, and CI is green.

**Files:**
- Create: `payment-gateway/package.json`
- Create: `payment-gateway/tsconfig.base.json`
- Create: `payment-gateway/README.md`
- Create: `payment-gateway/packages/domain/package.json`
- Create: `payment-gateway/packages/domain/tsconfig.json`
- Create: `payment-gateway/packages/domain/vitest.config.ts`
- Create: `payment-gateway/packages/domain/src/index.ts`
- Create: `payment-gateway/packages/domain/tests/smoke.test.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore` (append a Node section; the file currently covers only .NET)

**Interfaces:**
- Consumes: nothing.
- Produces: the `@registry/domain` workspace package, importable as `@registry/domain` from later packages; `npm test`, `npm run lint`, and `npm run build` scripts at `payment-gateway/`.

- [ ] **Step 1: Append the Node section to the existing root .gitignore**

The repo's `.gitignore` currently covers .NET, NuGet, and SQLite only. Append — do not replace:

```gitignore

## Node
node_modules/
dist/
coverage/
*.tsbuildinfo
.env
.env.local
```

- [ ] **Step 2: Create the workspace root package.json**

`payment-gateway/package.json`:

```json
{
  "name": "registry-payments",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "tsc -b packages/domain",
    "test": "npm run test --workspaces --if-present",
    "lint": "oxlint packages tools",
    "quote": "node --experimental-strip-types tools/quote.ts"
  },
  "devDependencies": {
    "@types/node": "^24.13.2",
    "oxlint": "^1.71.0",
    "typescript": "~6.0.2"
  }
}
```

`--experimental-strip-types` lets Node run the CLI directly from TypeScript with no build step, which keeps Task 13 honest: the CLI exercises the same source the tests do.

- [ ] **Step 3: Create the shared TypeScript config**

`payment-gateway/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "skipLibCheck": true
  }
}
```

`target: ES2023` matters: `bigint` literals require ES2020 or later, and the whole money model rests on them.

- [ ] **Step 4: Create the domain package**

`payment-gateway/packages/domain/package.json`:

```json
{
  "name": "@registry/domain",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^4.1.13"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

`payment-gateway/packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

`payment-gateway/packages/domain/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5: Write the smoke test**

`payment-gateway/packages/domain/tests/smoke.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME } from '../src/index.ts'

describe('domain package', () => {
  it('exposes its name', () => {
    expect(PACKAGE_NAME).toBe('@registry/domain')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd payment-gateway && npm install && npm test
```

Expected: FAIL — `Failed to resolve import "../src/index.ts"`.

- [ ] **Step 7: Write the minimal package entry**

`payment-gateway/packages/domain/src/index.ts`:

```typescript
export const PACKAGE_NAME = '@registry/domain'
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd payment-gateway && npm test
```

Expected: PASS — 1 test.

- [ ] **Step 9: Write the README**

`payment-gateway/README.md`:

```markdown
# Registry Payments

Property registration payment service — a proof of concept demonstrating
exactly-once money handling, webhook-as-source-of-truth, and jurisdiction
pluggability across six markets.

**All fee rates in `config/jurisdictions/` are synthetic.** They are
illustrative demonstration data and are not any jurisdiction's actual
statutory fees. See `docs/superpowers/specs/` for the full requirements.

## Layout

| Path | Contents |
|---|---|
| `packages/domain` | Pure domain: money, fee engine, rule pack loader. No I/O. |
| `config/jurisdictions` | Versioned fee rule packs, one JSON file per jurisdiction. |
| `config/fixtures` | Golden expected outputs, one per pack. |
| `tools/quote.ts` | CLI that computes a quote from a pack. |

## Commands

```bash
npm install          # from payment-gateway/
npm test             # unit tests
npm run lint         # oxlint
npm run build        # type-check and emit
npm run quote -- --all
```

## Adding a jurisdiction

Add one JSON file to `config/jurisdictions/` and one to `config/fixtures/`.
No TypeScript changes. The golden test suite discovers packs by globbing, so
a pack without fixtures fails CI.
```

- [ ] **Step 10: Create the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master, main]
  pull_request:

jobs:
  domain:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: payment-gateway
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
          cache-dependency-path: payment-gateway/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

- [ ] **Step 11: Commit — this is the repository's first commit**

```bash
cd "<repo root>"
git add .gitignore .github/workflows/ci.yml docs/superpowers payment-gateway
git commit -m "chore: initialise payment-gateway workspace and domain package"
```

Verify with `git log --oneline` that exactly one commit exists.

---

## Task 2: Currency registry

**Files:**
- Create: `payment-gateway/packages/domain/src/money/currency.ts`
- Create: `payment-gateway/packages/domain/tests/money/currency.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CurrencyCode = 'INR' | 'GBP' | 'JPY' | 'AED' | 'USD' | 'SGD' | 'KWD' | 'BHD'`
  - `interface CurrencyDefinition { code: CurrencyCode; minorUnitExponent: number; displayLocale: string }`
  - `const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyDefinition>>`
  - `function currencyOf(code: string): CurrencyDefinition` — throws `UnknownCurrencyError`
  - `function minorUnitExponent(code: CurrencyCode): number`
  - `function minorUnitsPerMajor(code: CurrencyCode): bigint` — `10n ** exponent`
  - `class UnknownCurrencyError extends Error`

`KWD` and `BHD` carry exponent 3 and are in the registry but not used by any pack. They exist so the rounding and formatting tests cover all three exponent classes the spec names (FR-0c), which is the only way a naive `/100` gets caught.

- [ ] **Step 1: Write the failing test**

`payment-gateway/packages/domain/tests/money/currency.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  CURRENCIES,
  UnknownCurrencyError,
  currencyOf,
  minorUnitExponent,
  minorUnitsPerMajor,
} from '../../src/money/currency.ts'

describe('currency registry', () => {
  it('gives every ISO 4217 exponent class the spec names', () => {
    expect(minorUnitExponent('INR')).toBe(2)
    expect(minorUnitExponent('GBP')).toBe(2)
    expect(minorUnitExponent('USD')).toBe(2)
    expect(minorUnitExponent('AED')).toBe(2)
    expect(minorUnitExponent('SGD')).toBe(2)
    expect(minorUnitExponent('JPY')).toBe(0)
    expect(minorUnitExponent('KWD')).toBe(3)
    expect(minorUnitExponent('BHD')).toBe(3)
  })

  it('derives minor units per major unit from the exponent, not from a constant', () => {
    expect(minorUnitsPerMajor('GBP')).toBe(100n)
    expect(minorUnitsPerMajor('JPY')).toBe(1n)
    expect(minorUnitsPerMajor('KWD')).toBe(1000n)
  })

  it('resolves a known code', () => {
    expect(currencyOf('JPY')).toEqual({
      code: 'JPY',
      minorUnitExponent: 0,
      displayLocale: 'ja-JP',
    })
  })

  it('throws on an unknown code rather than defaulting', () => {
    expect(() => currencyOf('XYZ')).toThrow(UnknownCurrencyError)
    expect(() => currencyOf('XYZ')).toThrow(/XYZ/)
  })

  it('is frozen, so no caller can mutate a currency definition', () => {
    expect(Object.isFrozen(CURRENCIES)).toBe(true)
    expect(Object.isFrozen(CURRENCIES.JPY)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/money/currency.test.ts
```

Expected: FAIL — cannot resolve `../../src/money/currency.ts`.

- [ ] **Step 3: Write the implementation**

`payment-gateway/packages/domain/src/money/currency.ts`:

```typescript
export type CurrencyCode =
  | 'INR'
  | 'GBP'
  | 'JPY'
  | 'AED'
  | 'USD'
  | 'SGD'
  | 'KWD'
  | 'BHD'

export interface CurrencyDefinition {
  readonly code: CurrencyCode
  /** ISO 4217 minor unit exponent. Never assume 2 — JPY is 0, KWD is 3. */
  readonly minorUnitExponent: number
  /** BCP 47 tag used for presentation only. Never used in arithmetic. */
  readonly displayLocale: string
}

export class UnknownCurrencyError extends Error {
  constructor(readonly code: string) {
    super(`Unknown currency code: ${code}`)
    this.name = 'UnknownCurrencyError'
  }
}

function define(
  code: CurrencyCode,
  minorUnitExponent: number,
  displayLocale: string,
): CurrencyDefinition {
  return Object.freeze({ code, minorUnitExponent, displayLocale })
}

export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyDefinition>> =
  Object.freeze({
    INR: define('INR', 2, 'en-IN'),
    GBP: define('GBP', 2, 'en-GB'),
    JPY: define('JPY', 0, 'ja-JP'),
    AED: define('AED', 2, 'en-AE'),
    USD: define('USD', 2, 'en-US'),
    SGD: define('SGD', 2, 'en-SG'),
    KWD: define('KWD', 3, 'ar-KW'),
    BHD: define('BHD', 3, 'ar-BH'),
  })

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCIES, code)
}

export function currencyOf(code: string): CurrencyDefinition {
  if (!isCurrencyCode(code)) throw new UnknownCurrencyError(code)
  return CURRENCIES[code]
}

export function minorUnitExponent(code: CurrencyCode): number {
  return CURRENCIES[code].minorUnitExponent
}

export function minorUnitsPerMajor(code: CurrencyCode): bigint {
  return 10n ** BigInt(minorUnitExponent(code))
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/money/currency.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add payment-gateway/packages/domain/src/money/currency.ts payment-gateway/packages/domain/tests/money/currency.test.ts
git commit -m "feat: add currency registry with per-currency minor unit exponents"
```

---

## Task 3: Rounding

Rounding is its own module and its own task because it is where money bugs hide. `bigint` division truncates toward zero, so every rounded operation in the engine goes through `divideRounded`; getting negative-value and exact-half behaviour right here means no later task has to think about it.

**Files:**
- Create: `payment-gateway/packages/domain/src/money/rounding.ts`
- Create: `payment-gateway/packages/domain/tests/money/rounding.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'CEIL' | 'FLOOR'`
  - `const ROUNDING_MODES: readonly RoundingMode[]`
  - `function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint`
  - `function roundToStep(amountMinor: bigint, stepMinor: bigint, mode: RoundingMode): bigint`

`CEIL` means toward positive infinity and `FLOOR` toward negative infinity — not "away from zero" and "toward zero". The test pins that, because a refund is a negative ledger amount and the two definitions disagree on negatives.

- [ ] **Step 1: Write the failing test**

`payment-gateway/packages/domain/tests/money/rounding.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { divideRounded, roundToStep } from '../../src/money/rounding.ts'

describe('divideRounded', () => {
  it('returns an exact quotient unchanged in every mode', () => {
    expect(divideRounded(100n, 4n, 'HALF_UP')).toBe(25n)
    expect(divideRounded(100n, 4n, 'HALF_EVEN')).toBe(25n)
    expect(divideRounded(100n, 4n, 'CEIL')).toBe(25n)
    expect(divideRounded(100n, 4n, 'FLOOR')).toBe(25n)
  })

  it('rounds an exact half away from zero under HALF_UP', () => {
    expect(divideRounded(5n, 2n, 'HALF_UP')).toBe(3n)
    expect(divideRounded(-5n, 2n, 'HALF_UP')).toBe(-3n)
  })

  it('rounds an exact half to the even neighbour under HALF_EVEN', () => {
    expect(divideRounded(5n, 2n, 'HALF_EVEN')).toBe(2n)
    expect(divideRounded(7n, 2n, 'HALF_EVEN')).toBe(4n)
    expect(divideRounded(-5n, 2n, 'HALF_EVEN')).toBe(-2n)
  })

  it('rounds below and above a half by magnitude, not by mode', () => {
    expect(divideRounded(4n, 3n, 'HALF_UP')).toBe(1n)
    expect(divideRounded(5n, 3n, 'HALF_UP')).toBe(2n)
  })

  it('treats CEIL as toward positive infinity, including for negatives', () => {
    expect(divideRounded(7n, 2n, 'CEIL')).toBe(4n)
    expect(divideRounded(-7n, 2n, 'CEIL')).toBe(-3n)
  })

  it('treats FLOOR as toward negative infinity, including for negatives', () => {
    expect(divideRounded(7n, 2n, 'FLOOR')).toBe(3n)
    expect(divideRounded(-7n, 2n, 'FLOOR')).toBe(-4n)
  })

  it('handles a negative denominator by sign, not by accident', () => {
    expect(divideRounded(7n, -2n, 'FLOOR')).toBe(-4n)
    expect(divideRounded(-7n, -2n, 'FLOOR')).toBe(3n)
  })

  it('refuses to divide by zero', () => {
    expect(() => divideRounded(1n, 0n, 'HALF_UP')).toThrow(/zero/i)
  })
})

describe('roundToStep', () => {
  it('is the identity when the step is one minor unit', () => {
    expect(roundToStep(12345n, 1n, 'HALF_UP')).toBe(12345n)
  })

  it('rounds up to the nearest whole major unit when asked', () => {
    // 123.45 -> 124.00 in a 2-exponent currency: step 100
    expect(roundToStep(12345n, 100n, 'CEIL')).toBe(12400n)
    expect(roundToStep(12300n, 100n, 'CEIL')).toBe(12300n)
  })

  it('rounds to the nearest step under HALF_UP', () => {
    expect(roundToStep(12350n, 100n, 'HALF_UP')).toBe(12400n)
    expect(roundToStep(12349n, 100n, 'HALF_UP')).toBe(12300n)
  })

  it('rejects a non-positive step', () => {
    expect(() => roundToStep(100n, 0n, 'HALF_UP')).toThrow(/step/i)
    expect(() => roundToStep(100n, -10n, 'HALF_UP')).toThrow(/step/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/money/rounding.test.ts
```

Expected: FAIL — cannot resolve `../../src/money/rounding.ts`.

- [ ] **Step 3: Write the implementation**

`payment-gateway/packages/domain/src/money/rounding.ts`:

```typescript
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'CEIL' | 'FLOOR'

export const ROUNDING_MODES: readonly RoundingMode[] = Object.freeze([
  'HALF_UP',
  'HALF_EVEN',
  'CEIL',
  'FLOOR',
] as const)

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

/**
 * Divide two integers and round the result under an explicit mode.
 *
 * Every rounded money operation in the engine goes through here. Plain
 * bigint division truncates toward zero, which is none of the four modes
 * the rule packs may name.
 *
 * CEIL is toward positive infinity and FLOOR toward negative infinity —
 * they are NOT "away from zero" and "toward zero". Refunds are negative,
 * so the distinction is load-bearing.
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (denominator === 0n) {
    throw new RangeError('divideRounded: cannot divide by zero')
  }

  const isNegative = numerator < 0n !== denominator < 0n
  const absNumerator = abs(numerator)
  const absDenominator = abs(denominator)

  const quotient = absNumerator / absDenominator
  const remainder = absNumerator % absDenominator

  if (remainder === 0n) return isNegative ? -quotient : quotient

  let magnitude: bigint
  switch (mode) {
    case 'FLOOR':
      // toward -inf: negatives grow in magnitude, positives truncate
      magnitude = isNegative ? quotient + 1n : quotient
      break
    case 'CEIL':
      // toward +inf: positives grow in magnitude, negatives truncate
      magnitude = isNegative ? quotient : quotient + 1n
      break
    case 'HALF_UP':
      magnitude = remainder * 2n >= absDenominator ? quotient + 1n : quotient
      break
    case 'HALF_EVEN': {
      const twiceRemainder = remainder * 2n
      if (twiceRemainder > absDenominator) magnitude = quotient + 1n
      else if (twiceRemainder < absDenominator) magnitude = quotient
      else magnitude = quotient % 2n === 0n ? quotient : quotient + 1n
      break
    }
  }

  return isNegative ? -magnitude : magnitude
}

/**
 * Round an amount to a coarser step than one minor unit.
 *
 * Some jurisdictions round duty up to the nearest whole currency unit; a
 * pack expresses that as a step of 10^exponent with mode CEIL.
 */
export function roundToStep(
  amountMinor: bigint,
  stepMinor: bigint,
  mode: RoundingMode,
): bigint {
  if (stepMinor <= 0n) {
    throw new RangeError(`roundToStep: step must be positive, got ${stepMinor}`)
  }
  if (stepMinor === 1n) return amountMinor
  return divideRounded(amountMinor, stepMinor, mode) * stepMinor
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/money/rounding.test.ts
```

Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add payment-gateway/packages/domain/src/money/rounding.ts payment-gateway/packages/domain/tests/money/rounding.test.ts
git commit -m "feat: add explicit integer rounding with four modes"
```

---

## Task 4: Money value object

**Files:**
- Create: `payment-gateway/packages/domain/src/money/money.ts`
- Create: `payment-gateway/packages/domain/tests/money/money.test.ts`

**Interfaces:**
- Consumes: `CurrencyCode`, `currencyOf`, `minorUnitsPerMajor` from `../money/currency.ts`; `RoundingMode`, `divideRounded`, `roundToStep` from `../money/rounding.ts`.
- Produces:
  - `class CurrencyMismatchError extends Error` with `left: CurrencyCode` and `right: CurrencyCode`
  - `class Money` — immutable, private constructor, with:
    - `static of(amountMinor: bigint, currency: CurrencyCode): Money`
    - `static zero(currency: CurrencyCode): Money`
    - `static fromMajorUnits(major: number, currency: CurrencyCode): Money` — test helper, integral majors only
    - `readonly amountMinor: bigint`
    - `readonly currency: CurrencyCode`
    - `add(other: Money): Money`
    - `subtract(other: Money): Money`
    - `negate(): Money`
    - `multiplyPpm(ratePpm: number, mode: RoundingMode): Money`
    - `roundTo(stepMinor: bigint, mode: RoundingMode): Money`
    - `clamp(min: Money | null, max: Money | null): Money`
    - `compare(other: Money): -1 | 0 | 1`
    - `equals(other: Money): boolean`
    - `isZero(): boolean` / `isNegative(): boolean`
    - `static max(a: Money, b: Money): Money` / `static min(a: Money, b: Money): Money`
    - `static sum(parts: readonly Money[], currency: CurrencyCode): Money`
    - `toString(): string` — diagnostic only, e.g. `"30020000 INR"`

`Money.sum` takes an explicit currency so summing an empty list still yields a typed zero rather than throwing or guessing — the fee engine needs that for a pack whose every component was conditioned away.

- [ ] **Step 1: Write the failing test**

`payment-gateway/packages/domain/tests/money/money.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { CurrencyMismatchError, Money } from '../../src/money/money.ts'

const inr = (minor: bigint) => Money.of(minor, 'INR')
const gbp = (minor: bigint) => Money.of(minor, 'GBP')

describe('Money construction', () => {
  it('carries an exact integer minor amount and its currency', () => {
    const m = inr(30020000n)
    expect(m.amountMinor).toBe(30020000n)
    expect(m.currency).toBe('INR')
  })

  it('builds a typed zero', () => {
    expect(Money.zero('JPY').amountMinor).toBe(0n)
    expect(Money.zero('JPY').currency).toBe('JPY')
  })

  it('converts integral major units using the currency exponent, not a constant', () => {
    expect(Money.fromMajorUnits(200000, 'INR').amountMinor).toBe(20000000n)
    expect(Money.fromMajorUnits(1250000, 'JPY').amountMinor).toBe(1250000n)
  })

  it('rejects a fractional major unit rather than silently truncating', () => {
    expect(() => Money.fromMajorUnits(1.5, 'GBP')).toThrow(/integer/i)
  })

  it('rejects an unknown currency', () => {
    // @ts-expect-error deliberately passing an invalid code to prove the runtime guard
    expect(() => Money.of(1n, 'XYZ')).toThrow(/XYZ/)
  })

  it('is immutable', () => {
    const m = inr(100n)
    expect(Object.isFrozen(m)).toBe(true)
  })
})

describe('Money arithmetic', () => {
  it('adds and subtracts within one currency', () => {
    expect(inr(100n).add(inr(23n)).amountMinor).toBe(123n)
    expect(inr(100n).subtract(inr(23n)).amountMinor).toBe(77n)
  })

  it('permits a negative result, because a refund is negative', () => {
    const result = inr(100n).subtract(inr(250n))
    expect(result.amountMinor).toBe(-150n)
    expect(result.isNegative()).toBe(true)
  })

  it('throws when currencies differ on add', () => {
    expect(() => inr(100n).add(gbp(100n))).toThrow(CurrencyMismatchError)
  })

  it('throws when currencies differ on subtract', () => {
    expect(() => inr(100n).subtract(gbp(100n))).toThrow(CurrencyMismatchError)
  })

  it('names both currencies in the mismatch error', () => {
    try {
      inr(1n).add(gbp(1n))
      expect.unreachable('expected a CurrencyMismatchError')
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyMismatchError)
      const mismatch = error as CurrencyMismatchError
      expect(mismatch.left).toBe('INR')
      expect(mismatch.right).toBe('GBP')
      expect(mismatch.message).toMatch(/INR/)
      expect(mismatch.message).toMatch(/GBP/)
    }
  })

  it('throws when currencies differ on compare, rather than ordering nonsense', () => {
    expect(() => inr(100n).compare(gbp(100n))).toThrow(CurrencyMismatchError)
  })

  it('negates', () => {
    expect(inr(100n).negate().amountMinor).toBe(-100n)
    expect(inr(-100n).negate().amountMinor).toBe(100n)
  })
})

describe('Money.multiplyPpm', () => {
  it('applies an integer parts-per-million rate', () => {
    // 4% of 500000000 paise = 20000000 paise
    expect(inr(500000000n).multiplyPpm(40000, 'HALF_UP').amountMinor).toBe(20000000n)
    // 0.5%
    expect(inr(500000000n).multiplyPpm(5000, 'HALF_UP').amountMinor).toBe(2500000n)
  })

  it('rounds under the mode it is given', () => {
    // 1 ppm of 1 minor unit = 0.000001 -> 0 or 1 depending on mode
    expect(inr(1n).multiplyPpm(1, 'FLOOR').amountMinor).toBe(0n)
    expect(inr(1n).multiplyPpm(1, 'CEIL').amountMinor).toBe(1n)
  })

  it('rounds an exact half under HALF_UP and HALF_EVEN differently', () => {
    // 500000 ppm (50%) of 5 minor units = 2.5
    expect(inr(5n).multiplyPpm(500000, 'HALF_UP').amountMinor).toBe(3n)
    expect(inr(5n).multiplyPpm(500000, 'HALF_EVEN').amountMinor).toBe(2n)
  })

  it('works in a zero-decimal currency', () => {
    // 2% of 60,000,000 yen = 1,200,000 yen
    expect(Money.of(60000000n, 'JPY').multiplyPpm(20000, 'HALF_UP').amountMinor).toBe(1200000n)
  })

  it('preserves currency', () => {
    expect(gbp(100n).multiplyPpm(20000, 'HALF_UP').currency).toBe('GBP')
  })

  it('rejects a non-integer or negative rate', () => {
    expect(() => inr(100n).multiplyPpm(1.5, 'HALF_UP')).toThrow(/integer/i)
    expect(() => inr(100n).multiplyPpm(-1, 'HALF_UP')).toThrow(/negative/i)
  })
})

describe('Money bounds', () => {
  it('clamps to a minimum', () => {
    expect(inr(500n).clamp(inr(1000n), null).amountMinor).toBe(1000n)
    expect(inr(5000n).clamp(inr(1000n), null).amountMinor).toBe(5000n)
  })

  it('clamps to a maximum', () => {
    expect(inr(50000n).clamp(null, inr(22500n)).amountMinor).toBe(22500n)
    expect(inr(7500n).clamp(null, inr(22500n)).amountMinor).toBe(7500n)
  })

  it('is a no-op when both bounds are null', () => {
    expect(inr(777n).clamp(null, null).amountMinor).toBe(777n)
  })

  it('throws when a bound is in another currency', () => {
    expect(() => inr(500n).clamp(gbp(1000n), null)).toThrow(CurrencyMismatchError)
  })

  it('throws when the minimum exceeds the maximum, because that pack is wrong', () => {
    expect(() => inr(500n).clamp(inr(900n), inr(100n))).toThrow(/minimum/i)
  })

  it('rounds to a coarser step', () => {
    expect(inr(12345n).roundTo(100n, 'CEIL').amountMinor).toBe(12400n)
  })
})

describe('Money aggregation', () => {
  it('sums a list', () => {
    const total = Money.sum([inr(20000000n), inr(7500000n), inr(2500000n), inr(20000n)], 'INR')
    expect(total.amountMinor).toBe(30020000n)
  })

  it('sums an empty list to a typed zero', () => {
    expect(Money.sum([], 'GBP').amountMinor).toBe(0n)
    expect(Money.sum([], 'GBP').currency).toBe('GBP')
  })

  it('throws if any part is in another currency', () => {
    expect(() => Money.sum([inr(1n), gbp(1n)], 'INR')).toThrow(CurrencyMismatchError)
  })

  it('throws if a part disagrees with the declared currency', () => {
    expect(() => Money.sum([gbp(1n)], 'INR')).toThrow(CurrencyMismatchError)
  })

  it('picks a maximum and a minimum', () => {
    expect(Money.max(inr(100n), inr(250n)).amountMinor).toBe(250n)
    expect(Money.min(inr(100n), inr(250n)).amountMinor).toBe(100n)
  })

  it('throws when comparing across currencies for a maximum', () => {
    expect(() => Money.max(inr(100n), gbp(250n))).toThrow(CurrencyMismatchError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/money/money.test.ts
```

Expected: FAIL — cannot resolve `../../src/money/money.ts`.

- [ ] **Step 3: Write the implementation**

`payment-gateway/packages/domain/src/money/money.ts`:

```typescript
import {
  type CurrencyCode,
  currencyOf,
  minorUnitsPerMajor,
} from './currency.ts'
import {
  type RoundingMode,
  divideRounded,
  roundToStep,
} from './rounding.ts'

const PPM_DENOMINATOR = 1_000_000n

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: CurrencyCode,
    readonly right: CurrencyCode,
    operation: string,
  ) {
    super(
      `Cannot ${operation} across currencies: ${left} and ${right}. ` +
        'Mixing currencies is a defect, not a conversion — this system does no FX.',
    )
    this.name = 'CurrencyMismatchError'
  }
}

/**
 * An exact amount of money in one currency.
 *
 * Held as an integer count of the currency's minor unit. There is no
 * floating point anywhere in this class and no bare numeric money type in
 * the codebase. Arithmetic across currencies throws.
 */
export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: CurrencyCode,
  ) {
    Object.freeze(this)
  }

  static of(amountMinor: bigint, currency: CurrencyCode): Money {
    // Validates the code at runtime; callers may come from parsed JSON.
    currencyOf(currency)
    if (typeof amountMinor !== 'bigint') {
      throw new TypeError(
        `Money.of: amountMinor must be a bigint, got ${typeof amountMinor}`,
      )
    }
    return new Money(amountMinor, currency)
  }

  static zero(currency: CurrencyCode): Money {
    return Money.of(0n, currency)
  }

  /**
   * Convenience for tests and fixtures. Accepts whole major units only —
   * a fractional major unit means the caller is thinking in floats.
   */
  static fromMajorUnits(major: number, currency: CurrencyCode): Money {
    if (!Number.isInteger(major)) {
      throw new RangeError(
        `Money.fromMajorUnits: expected an integer major amount, got ${major}. ` +
          'Construct fractional amounts with Money.of and minor units.',
      )
    }
    return Money.of(BigInt(major) * minorUnitsPerMajor(currency), currency)
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency, operation)
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'add')
    return new Money(this.amountMinor + other.amountMinor, this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract')
    return new Money(this.amountMinor - other.amountMinor, this.currency)
  }

  negate(): Money {
    return new Money(-this.amountMinor, this.currency)
  }

  /**
   * Apply an integer parts-per-million rate. 0.5% is 5000 ppm, 4% is 40000.
   * Rates are never floating-point percentages (FR-6).
   */
  multiplyPpm(ratePpm: number, mode: RoundingMode): Money {
    if (!Number.isInteger(ratePpm)) {
      throw new RangeError(
        `Money.multiplyPpm: ratePpm must be an integer, got ${ratePpm}`,
      )
    }
    if (ratePpm < 0) {
      throw new RangeError(
        `Money.multiplyPpm: ratePpm must not be negative, got ${ratePpm}`,
      )
    }
    const scaled = this.amountMinor * BigInt(ratePpm)
    return new Money(divideRounded(scaled, PPM_DENOMINATOR, mode), this.currency)
  }

  roundTo(stepMinor: bigint, mode: RoundingMode): Money {
    return new Money(roundToStep(this.amountMinor, stepMinor, mode), this.currency)
  }

  clamp(min: Money | null, max: Money | null): Money {
    if (min !== null) this.assertSameCurrency(min, 'clamp')
    if (max !== null) this.assertSameCurrency(max, 'clamp')
    if (min !== null && max !== null && min.amountMinor > max.amountMinor) {
      throw new RangeError(
        `Money.clamp: minimum ${min.amountMinor} exceeds maximum ${max.amountMinor}`,
      )
    }
    let result: bigint = this.amountMinor
    if (min !== null && result < min.amountMinor) result = min.amountMinor
    if (max !== null && result > max.amountMinor) result = max.amountMinor
    return new Money(result, this.currency)
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other, 'compare')
    if (this.amountMinor < other.amountMinor) return -1
    if (this.amountMinor > other.amountMinor) return 1
    return 0
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor
  }

  isZero(): boolean {
    return this.amountMinor === 0n
  }

  isNegative(): boolean {
    return this.amountMinor < 0n
  }

  static max(a: Money, b: Money): Money {
    return a.compare(b) >= 0 ? a : b
  }

  static min(a: Money, b: Money): Money {
    return a.compare(b) <= 0 ? a : b
  }

  /**
   * Sum a list. The currency is explicit so an empty list yields a typed
   * zero rather than throwing — a pack whose every component was
   * conditioned away is legal and totals zero.
   */
  static sum(parts: readonly Money[], currency: CurrencyCode): Money {
    let total = Money.zero(currency)
    for (const part of parts) total = total.add(part)
    return total
  }

  /** Diagnostic only. Never render this to a user — use formatMoney. */
  toString(): string {
    return `${this.amountMinor} ${this.currency}`
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/money/money.test.ts
```

Expected: PASS — 27 tests.

- [ ] **Step 5: Commit**

```bash
git add payment-gateway/packages/domain/src/money/money.ts payment-gateway/packages/domain/tests/money/money.test.ts
git commit -m "feat: add Money value object that throws on cross-currency arithmetic"
```

---

## Task 5: Presentation formatting and the wire codec

Two concerns, one task, because they are the same boundary seen from both sides: `wire.ts` is how money leaves the domain as data, `format.ts` is how it leaves as text for a human. A reviewer gating one would gate the other.

**Files:**
- Create: `payment-gateway/packages/domain/src/money/format.ts`
- Create: `payment-gateway/packages/domain/src/money/wire.ts`
- Create: `payment-gateway/packages/domain/src/money/index.ts`
- Create: `payment-gateway/packages/domain/tests/money/format.test.ts`
- Create: `payment-gateway/packages/domain/tests/money/wire.test.ts`
- Modify: `payment-gateway/packages/domain/src/index.ts` (re-export the money module)

**Interfaces:**
- Consumes: `Money`, `CurrencyCode`, `currencyOf`, `minorUnitExponent`, `isCurrencyCode`.
- Produces:
  - `interface MoneyWire { readonly amountMinor: string; readonly currency: string }`
  - `function toWire(money: Money): MoneyWire`
  - `function fromWire(wire: MoneyWire): Money` — throws `InvalidMoneyWireError`
  - `class InvalidMoneyWireError extends Error`
  - `interface FormatMoneyOptions { locale?: string; withSymbol?: boolean }`
  - `function formatMoney(money: Money, options?: FormatMoneyOptions): string`
  - and the module barrel `src/money/index.ts` re-exporting currency, rounding, money, format, wire.

`formatMoney` derives fraction digits from the currency exponent, so `¥1,250,000` has no decimals and `£6,500.00` has two. A receipt reading `¥1250000.00` is a defect (RCP-2), and this function is the only place that can cause it.

Note on assertions: `Intl.NumberFormat` uses U+00A0 and U+202F for some separators depending on the ICU version. The tests normalise whitespace before comparing rather than pinning exact code points, which would make the suite brittle across Node upgrades.

- [ ] **Step 1: Write the failing wire test**

`payment-gateway/packages/domain/tests/money/wire.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/money.ts'
import { InvalidMoneyWireError, fromWire, toWire } from '../../src/money/wire.ts'

describe('toWire', () => {
  it('emits the amount as a string, because JSON has no BigInt', () => {
    const wire = toWire(Money.of(30020000n, 'INR'))
    expect(wire).toEqual({ amountMinor: '30020000', currency: 'INR' })
    expect(typeof wire.amountMinor).toBe('string')
  })

  it('emits a negative amount as a signed string', () => {
    expect(toWire(Money.of(-650000n, 'GBP')).amountMinor).toBe('-650000')
  })

  it('survives a JSON round trip', () => {
    const original = Money.of(1250000n, 'JPY')
    const parsed = fromWire(JSON.parse(JSON.stringify(toWire(original))))
    expect(parsed.equals(original)).toBe(true)
  })
})

describe('fromWire', () => {
  it('parses a valid payload', () => {
    const money = fromWire({ amountMinor: '493000', currency: 'USD' })
    expect(money.amountMinor).toBe(493000n)
    expect(money.currency).toBe('USD')
  })

  it('parses a negative amount', () => {
    expect(fromWire({ amountMinor: '-1', currency: 'USD' }).amountMinor).toBe(-1n)
  })

  it('rejects a floating point amount rather than truncating it', () => {
    expect(() => fromWire({ amountMinor: '123.45', currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
  })

  it('rejects a number where a string is required', () => {
    // @ts-expect-error deliberately passing a number to prove the runtime guard
    expect(() => fromWire({ amountMinor: 12345, currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
  })

  it('rejects an empty or non-numeric amount', () => {
    expect(() => fromWire({ amountMinor: '', currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
    expect(() => fromWire({ amountMinor: 'NaN', currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
    expect(() => fromWire({ amountMinor: '1e5', currency: 'USD' })).toThrow(
      InvalidMoneyWireError,
    )
  })

  it('rejects an unknown currency', () => {
    expect(() => fromWire({ amountMinor: '1', currency: 'XYZ' })).toThrow(
      InvalidMoneyWireError,
    )
  })

  it('names the offending value in the error, for a legible API 400', () => {
    expect(() => fromWire({ amountMinor: '1.5', currency: 'USD' })).toThrow(/1\.5/)
  })
})
```

- [ ] **Step 2: Write the failing format test**

`payment-gateway/packages/domain/tests/money/format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { formatMoney } from '../../src/money/format.ts'
import { Money } from '../../src/money/money.ts'

/** Intl separator code points vary by ICU version; compare on plain spaces. */
const normalise = (value: string) => value.replace(/[  ]/g, ' ')

describe('formatMoney', () => {
  it('shows two decimals for a two-exponent currency', () => {
    expect(normalise(formatMoney(Money.of(650000n, 'GBP')))).toBe('£6,500.00')
  })

  it('shows NO decimals for yen, because JPY has no minor unit', () => {
    const formatted = normalise(formatMoney(Money.of(1250000n, 'JPY')))
    expect(formatted).toContain('1,250,000')
    expect(formatted).not.toContain('.')
  })

  it('shows three decimals for a three-exponent currency', () => {
    expect(normalise(formatMoney(Money.of(1234n, 'KWD')))).toMatch(/1\.234/)
  })

  it('uses Indian grouping for rupees', () => {
    // 30020000 paise = 3,00,200.00 rupees in the lakh convention
    expect(normalise(formatMoney(Money.of(30020000n, 'INR')))).toContain('3,00,200.00')
  })

  it('groups US dollars in thousands', () => {
    expect(normalise(formatMoney(Money.of(493000n, 'USD')))).toBe('$4,930.00')
  })

  it('formats a negative amount', () => {
    expect(normalise(formatMoney(Money.of(-650000n, 'GBP')))).toMatch(/6,500\.00/)
    expect(normalise(formatMoney(Money.of(-650000n, 'GBP')))).toMatch(/-|\(/)
  })

  it('formats zero', () => {
    expect(normalise(formatMoney(Money.zero('GBP')))).toBe('£0.00')
  })

  it('omits the symbol when asked, for table columns that carry their own header', () => {
    const formatted = normalise(formatMoney(Money.of(650000n, 'GBP'), { withSymbol: false }))
    expect(formatted).toBe('6,500.00')
  })

  it('honours an explicit locale override', () => {
    const formatted = normalise(formatMoney(Money.of(650000n, 'GBP'), { locale: 'de-DE' }))
    expect(formatted).toContain('6.500,00')
  })

  it('is exact for a very large amount, with no float drift', () => {
    // 9007199254740993 exceeds Number.MAX_SAFE_INTEGER by 2
    const formatted = normalise(formatMoney(Money.of(9007199254740993n, 'JPY')))
    expect(formatted).toContain('9,007,199,254,740,993')
  })
})
```

The last case is the one that matters: it passes only if the implementation hands the `bigint` to `Intl` without a `Number()` conversion on the way.

- [ ] **Step 3: Run both tests to verify they fail**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/money/wire.test.ts tests/money/format.test.ts
```

Expected: FAIL — cannot resolve `../../src/money/wire.ts` or `../../src/money/format.ts`.

- [ ] **Step 4: Write the wire codec**

`payment-gateway/packages/domain/src/money/wire.ts`:

```typescript
import { type CurrencyCode, isCurrencyCode } from './currency.ts'
import { Money } from './money.ts'

/**
 * How money crosses any boundary — HTTP, persisted JSON, a log line.
 * The amount is a decimal integer STRING because JSON has no BigInt and a
 * JS number would silently lose precision above 2^53 (FR-0d).
 */
export interface MoneyWire {
  readonly amountMinor: string
  readonly currency: string
}

/** Decimal integer, optional leading minus. No exponent, no decimal point. */
const MINOR_AMOUNT_PATTERN = /^-?\d+$/

export class InvalidMoneyWireError extends Error {
  constructor(reason: string, readonly received: unknown) {
    super(`Invalid money payload: ${reason} (received ${JSON.stringify(received)})`)
    this.name = 'InvalidMoneyWireError'
  }
}

export function toWire(money: Money): MoneyWire {
  return { amountMinor: money.amountMinor.toString(), currency: money.currency }
}

export function fromWire(wire: MoneyWire): Money {
  if (typeof wire?.amountMinor !== 'string') {
    throw new InvalidMoneyWireError(
      'amountMinor must be a decimal integer string',
      wire?.amountMinor,
    )
  }
  if (!MINOR_AMOUNT_PATTERN.test(wire.amountMinor)) {
    throw new InvalidMoneyWireError(
      'amountMinor must be a decimal integer with no decimal point or exponent',
      wire.amountMinor,
    )
  }
  if (typeof wire.currency !== 'string' || !isCurrencyCode(wire.currency)) {
    throw new InvalidMoneyWireError('unknown currency code', wire.currency)
  }
  const currency: CurrencyCode = wire.currency
  return Money.of(BigInt(wire.amountMinor), currency)
}
```

- [ ] **Step 5: Write the formatter**

`payment-gateway/packages/domain/src/money/format.ts`:

```typescript
import { currencyOf, minorUnitExponent } from './currency.ts'
import type { Money } from './money.ts'

export interface FormatMoneyOptions {
  /** BCP 47 override. Defaults to the currency's own display locale. */
  readonly locale?: string
  /** Include the currency symbol. Default true. */
  readonly withSymbol?: boolean
}

/**
 * Render money for a human.
 *
 * PRESENTATION ONLY. Never parse the output of this function, never do
 * arithmetic on it, and never send it across the wire as data — use
 * toWire for that.
 *
 * Fraction digits come from the currency's ISO 4217 exponent, so yen
 * renders as ¥1,250,000 and sterling as £6,500.00. A receipt reading
 * ¥1250000.00 is a defect (RCP-2), and this is the only function that
 * could produce one.
 */
export function formatMoney(money: Money, options: FormatMoneyOptions = {}): string {
  const definition = currencyOf(money.currency)
  const exponent = minorUnitExponent(money.currency)
  const locale = options.locale ?? definition.displayLocale
  const withSymbol = options.withSymbol ?? true

  const formatter = new Intl.NumberFormat(locale, {
    ...(withSymbol
      ? { style: 'currency' as const, currency: money.currency }
      : { style: 'decimal' as const }),
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  })

  // Intl accepts a bigint directly, and also a [bigint, scale] decimal pair.
  // Passing the bigint with an explicit scale keeps precision above 2^53 —
  // a Number() conversion here would be a silent correctness bug.
  return formatter.format(
    exponent === 0
      ? money.amountMinor
      : ({ toString: () => scaledDecimalString(money.amountMinor, exponent) } as never),
  )
}

/** Render an integer minor amount as an exact decimal string, e.g. 650000 -> "6500.00". */
function scaledDecimalString(amountMinor: bigint, exponent: number): string {
  const divisor = 10n ** BigInt(exponent)
  const negative = amountMinor < 0n
  const magnitude = negative ? -amountMinor : amountMinor
  const whole = magnitude / divisor
  const fraction = (magnitude % divisor).toString().padStart(exponent, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}
```

**Implementation note for the executor.** `Intl.NumberFormat.format` accepts a string argument holding an exact decimal, and modern V8 preserves its precision. If the large-amount test in Step 2 fails on your Node version, replace the `format(...)` call with `formatter.format(scaledDecimalString(...) as never)` for every exponent including 0, and re-run. Do **not** "fix" it by wrapping the value in `Number()` — that is the precision bug the test exists to catch. If neither form passes, stop and report it rather than weakening the test.

- [ ] **Step 6: Write the module barrel**

`payment-gateway/packages/domain/src/money/index.ts`:

```typescript
export {
  CURRENCIES,
  UnknownCurrencyError,
  currencyOf,
  isCurrencyCode,
  minorUnitExponent,
  minorUnitsPerMajor,
} from './currency.ts'
export type { CurrencyCode, CurrencyDefinition } from './currency.ts'

export { ROUNDING_MODES, divideRounded, roundToStep } from './rounding.ts'
export type { RoundingMode } from './rounding.ts'

export { CurrencyMismatchError, Money } from './money.ts'

export { formatMoney } from './format.ts'
export type { FormatMoneyOptions } from './format.ts'

export { InvalidMoneyWireError, fromWire, toWire } from './wire.ts'
export type { MoneyWire } from './wire.ts'
```

- [ ] **Step 7: Re-export the money module from the package entry**

Replace the contents of `payment-gateway/packages/domain/src/index.ts`:

```typescript
export const PACKAGE_NAME = '@registry/domain'

export * from './money/index.ts'
```

- [ ] **Step 8: Run the whole suite to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run
```

Expected: PASS — all money tests plus the smoke test.

- [ ] **Step 9: Commit**

```bash
git add payment-gateway/packages/domain/src/money payment-gateway/packages/domain/src/index.ts payment-gateway/packages/domain/tests/money
git commit -m "feat: add money wire codec and exponent-aware presentation formatting"
```

---

## Task 6: Source guards

Two properties the spec states as blocking (NFR-1, FR-1, success criteria 11 and 12) cannot be asserted by a unit test of behaviour — they are properties of the source text. oxlint has no custom-rule facility, so these are tests that read the source directory. They live in `tests/guards/` so nobody mistakes them for redundant unit tests.

**Files:**
- Create: `payment-gateway/packages/domain/tests/guards/no-float-money.test.ts`
- Create: `payment-gateway/packages/domain/tests/guards/source-scan.ts` (shared helper)

**Interfaces:**
- Consumes: nothing from the domain.
- Produces: `function readSourceFiles(relativeDir: string): Array<{ path: string; text: string }>` for reuse by the second guard added in Task 12.

- [ ] **Step 1: Write the source-scan helper**

`payment-gateway/packages/domain/tests/guards/source-scan.ts`:

```typescript
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

export interface SourceFile {
  /** Path relative to the package root, e.g. "src/fees/compute.ts". */
  readonly path: string
  readonly text: string
}

/** Read every .ts file beneath a directory relative to the package root. */
export function readSourceFiles(relativeDir: string): SourceFile[] {
  const absolute = join(packageRoot, relativeDir)
  const files: SourceFile[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    const full = join(entry.parentPath, entry.name)
    files.push({
      path: relative(packageRoot, full).replaceAll('\\', '/'),
      text: readFileSync(full, 'utf8'),
    })
  }
  return files
}

/** Strip line and block comments so a guard never flags prose. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}
```

`readdirSync` with `recursive: true` and `entry.parentPath` requires Node 20.12 or later; the workspace pins Node 24.

- [ ] **Step 2: Write the failing guard test**

`payment-gateway/packages/domain/tests/guards/no-float-money.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { readSourceFiles, stripComments } from './source-scan.ts'

/**
 * Money is exact integer arithmetic on bigint. These patterns are how
 * float arithmetic gets into a money path (NFR-1, success criterion 11).
 *
 * money.ts and rounding.ts are the only files permitted to do integer
 * arithmetic on a minor amount at all — everything else must go through
 * the Money methods.
 */
const ARITHMETIC_ALLOWED_IN = new Set(['src/money/money.ts', 'src/money/rounding.ts'])

const FORBIDDEN = [
  {
    name: 'Number() applied to a minor amount',
    pattern: /Number\s*\(\s*[\w.]*amountMinor/,
  },
  {
    name: 'parseFloat or parseInt on a minor amount',
    pattern: /parse(?:Float|Int)\s*\(\s*[\w.]*amountMinor/,
  },
  {
    name: 'a hardcoded divide-or-multiply by 100, instead of the currency exponent',
    pattern: /amountMinor\s*[/*]\s*100\b|\b100\s*[/*]\s*[\w.]*amountMinor/,
  },
  {
    name: 'a float literal in a money or rate context',
    pattern: /(?:amountMinor|ratePpm)\s*[-+*/]\s*\d+\.\d+/,
  },
  {
    name: 'Math.round, Math.floor or Math.ceil on money — use divideRounded',
    pattern: /Math\.(?:round|floor|ceil)\s*\(\s*[\w.]*(?:amountMinor|Minor)\b/,
  },
]

describe('no float arithmetic on money', () => {
  const sources = readSourceFiles('src')

  it('finds source files to scan, so a broken glob cannot pass vacuously', () => {
    expect(sources.length).toBeGreaterThan(4)
  })

  for (const { name, pattern } of FORBIDDEN) {
    it(`has no ${name}`, () => {
      const offenders = sources
        .filter((file) => pattern.test(stripComments(file.text)))
        .map((file) => file.path)
      expect(offenders).toEqual([])
    })
  }

  it('does bare arithmetic on a minor amount only inside the money primitives', () => {
    const offenders = sources
      .filter((file) => !ARITHMETIC_ALLOWED_IN.has(file.path))
      .filter((file) => /amountMinor\s*[-+*/]\s*(?!\s*$)/.test(stripComments(file.text)))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test to verify it passes against current source**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/guards/no-float-money.test.ts
```

Expected: PASS. Unlike the other tasks this guard should pass immediately — the source it protects is already correct. Its value is in failing later.

- [ ] **Step 4: Prove the guard actually detects a violation**

A guard that has never gone red is not a guard. Temporarily append to `src/money/format.ts`:

```typescript
export const BROKEN = (m: { amountMinor: bigint }) => Number(m.amountMinor) / 100
```

Run the guard again:

```bash
cd payment-gateway/packages/domain && npx vitest run tests/guards/no-float-money.test.ts
```

Expected: FAIL on at least two patterns, naming `src/money/format.ts`. Then **remove the line** and re-run to confirm PASS. Do not commit the temporary line.

- [ ] **Step 5: Commit**

```bash
git add payment-gateway/packages/domain/tests/guards
git commit -m "test: guard against float arithmetic reaching a money path"
```

---

## Task 7: Rule pack types and schema

The pack schema *is* the pluggability boundary. Every jurisdictional difference the spec names must be expressible here, because anything that is not becomes a code branch later — which FR-1 forbids.

**Files:**
- Create: `payment-gateway/packages/domain/src/fees/types.ts`
- Create: `payment-gateway/packages/domain/src/fees/schema.ts`
- Create: `payment-gateway/packages/domain/tests/fees/schema.test.ts`

**Interfaces:**
- Consumes: `CurrencyCode`, `RoundingMode`, `Money`, `MoneyWire`.
- Produces (types, from `types.ts`):
  - `type PropertyType = 'LAND' | 'HOUSE' | 'APARTMENT' | 'COMMERCIAL'`
  - `type TransactionType = 'SALE' | 'GIFT' | 'MORTGAGE' | 'LEASE'`
  - `type BasisStrategy = 'MAX_OF_MARKET_AND_CONSIDERATION' | 'CONSIDERATION_ONLY' | 'MARKET_ONLY'`
  - `type Provenance = 'SOURCED' | 'SYNTHETIC'`
  - `type AttributeValue = string | number | boolean`
  - `type Condition` — the discriminated union below
  - `type FeeComponentRule` — `FlatRule | ProportionalRule | ProgressiveBandsRule`
  - `interface RequiredAttribute { name: string; kind: 'string' | 'number' | 'boolean'; label: string; options: readonly string[] | null }`
  - `interface JurisdictionRulePack`
  - `interface FeeInput`
  - `interface FeeBreakdown`, `interface ComputedComponent`, `interface AppliedRule`, `interface ComputedBand`
- Produces (schemas, from `schema.ts`):
  - `const JurisdictionRulePackSchema: z.ZodType<JurisdictionRulePack>`
  - `function parseRulePack(raw: unknown, sourceLabel: string): JurisdictionRulePack` — throws `InvalidRulePackError`
  - `class InvalidRulePackError extends Error`

**The condition union.** These eight operators cover every conditional the spec's six packs need and nothing more:

| Operator | Shape | Used by |
|---|---|---|
| `always` | `{ op: 'always' }` | default for unconditional components |
| `eq` | `{ op: 'eq', attribute, value }` | US-CA county selection, SG residency |
| `lte` / `gte` | `{ op: 'lte', attribute, value: number }` | numeric attribute thresholds |
| `basisLte` / `basisGte` | `{ op: 'basisLte', amountMinor: string }` | GB-ENG first-time-buyer relief threshold |
| `not` | `{ op: 'not', of: Condition }` | negation without a second operator per case |
| `all` / `any` | `{ op: 'all', of: Condition[] }` | GB-ENG relief: first-time buyer **and** under threshold |

- [ ] **Step 1: Write the types**

`payment-gateway/packages/domain/src/fees/types.ts`:

```typescript
import type { CurrencyCode, Money, MoneyWire, RoundingMode } from '../money/index.ts'

export type PropertyType = 'LAND' | 'HOUSE' | 'APARTMENT' | 'COMMERCIAL'
export type TransactionType = 'SALE' | 'GIFT' | 'MORTGAGE' | 'LEASE'

/** How a pack decides the value the fees are charged on (FR-3). */
export type BasisStrategy =
  | 'MAX_OF_MARKET_AND_CONSIDERATION'
  | 'CONSIDERATION_ONLY'
  | 'MARKET_ONLY'

/** FR-10. There is no third state; an unmarked pack fails to load. */
export type Provenance = 'SOURCED' | 'SYNTHETIC'

export type AttributeValue = string | number | boolean

export type Condition =
  | { readonly op: 'always' }
  | { readonly op: 'eq'; readonly attribute: string; readonly value: AttributeValue }
  | { readonly op: 'lte'; readonly attribute: string; readonly value: number }
  | { readonly op: 'gte'; readonly attribute: string; readonly value: number }
  | { readonly op: 'basisLte'; readonly amountMinor: string }
  | { readonly op: 'basisGte'; readonly amountMinor: string }
  | { readonly op: 'not'; readonly of: Condition }
  | { readonly op: 'all'; readonly of: readonly Condition[] }
  | { readonly op: 'any'; readonly of: readonly Condition[] }

interface ComponentRuleBase {
  readonly code: string
  readonly label: string
  /** When this component applies. Defaults to always. */
  readonly condition: Condition
  readonly rounding: RoundingMode
  /**
   * Round to this many minor units. "1" means the currency's minor unit;
   * a pack that rounds duty up to the whole currency unit sets 10^exponent
   * with rounding CEIL.
   */
  readonly roundToStepMinor: string
  readonly minAmountMinor: string | null
  readonly maxAmountMinor: string | null
}

export interface FlatRule extends ComponentRuleBase {
  readonly kind: 'FLAT'
  readonly amountMinor: string
  /**
   * Multiply the flat amount by this numeric attribute. Per-document
   * recording fees use it; null means charge once.
   */
  readonly timesAttribute: string | null
}

export interface ProportionalRule extends ComponentRuleBase {
  readonly kind: 'PROPORTIONAL'
  /** Integer parts-per-million. 0.5% is 5000 (FR-6). */
  readonly ratePpm: number
  /**
   * Charge on a numeric attribute (in minor units) instead of the pack's
   * chargeable value. A mortgage registration fee charged on the loan
   * amount uses it; null means use the chargeable value.
   */
  readonly basisAttribute: string | null
}

export interface Band {
  /** Upper bound in minor units, inclusive. null means unbounded. */
  readonly upToMinor: string | null
  readonly ratePpm: number
}

export interface ProgressiveBandsRule extends ComponentRuleBase {
  readonly kind: 'PROGRESSIVE_BANDS'
  /** Ordered ascending. Each band charges only its own slice (marginal). */
  readonly bands: readonly Band[]
}

export type FeeComponentRule = FlatRule | ProportionalRule | ProgressiveBandsRule

export interface RequiredAttribute {
  readonly name: string
  readonly kind: 'string' | 'number' | 'boolean'
  readonly label: string
  /** Permitted values for a string attribute, or null for free text. */
  readonly options: readonly string[] | null
}

export interface JurisdictionRulePack {
  /** ISO 3166 based, e.g. "IN-TG", "GB-ENG", "US-CA", "SG". */
  readonly id: string
  readonly jurisdictionLabel: string
  readonly currency: CurrencyCode
  readonly version: string
  /** IANA zone, used for display and business-day logic only (NFR-8a). */
  readonly timezone: string
  readonly provenance: Provenance
  /** Citation URL. Required when provenance is SOURCED (FR-10). */
  readonly packSource: string | null
  readonly packRetrievedAt: string | null
  readonly basisStrategy: BasisStrategy
  /** Drives client form generation; validation is derived from this (FR-2). */
  readonly requiredAttributes: readonly RequiredAttribute[]
  readonly components: readonly FeeComponentRule[]
}

export interface FeeInput {
  readonly jurisdictionId: string
  readonly propertyType: PropertyType
  readonly transactionType: TransactionType
  readonly consideration: Money
  readonly marketValue: Money
  readonly attributes: Readonly<Record<string, AttributeValue>>
}

/** One human-readable statement of a rule the engine actually applied (FR-5). */
export interface AppliedRule {
  readonly code: string
  readonly detail: string
}

export interface ComputedBand {
  readonly fromMinor: string
  readonly toMinor: string | null
  readonly slicedMinor: string
  readonly ratePpm: number
  readonly amount: MoneyWire
}

export interface ComputedComponent {
  readonly code: string
  readonly label: string
  readonly kind: FeeComponentRule['kind']
  readonly applied: boolean
  /** The value this component was charged on, when it had one. */
  readonly basis: MoneyWire | null
  readonly ratePpm: number | null
  readonly bands: readonly ComputedBand[] | null
  readonly amount: MoneyWire
  readonly appliedRules: readonly AppliedRule[]
}

export interface FeeBreakdown {
  readonly jurisdictionId: string
  readonly currency: CurrencyCode
  readonly chargeableValue: MoneyWire
  readonly basisStrategy: BasisStrategy
  readonly components: readonly ComputedComponent[]
  readonly total: MoneyWire
  readonly packId: string
  readonly packVersion: string
  readonly provenance: Provenance
  readonly packSource: string | null
  readonly packRetrievedAt: string | null
  readonly disclaimer: string
}
```

`FeeBreakdown` holds `MoneyWire`, not `Money`, deliberately: it is the object that gets persisted on an application and returned from the API, and making it wire-shaped at birth removes any chance of a `Money` instance being `JSON.stringify`-ed into `{}`.

- [ ] **Step 2: Write the failing schema test**

`payment-gateway/packages/domain/tests/fees/schema.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { InvalidRulePackError, parseRulePack } from '../../src/fees/schema.ts'

/** A minimal valid pack. Individual tests override one field at a time. */
function validPack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'TEST',
    jurisdictionLabel: 'Test Jurisdiction',
    currency: 'GBP',
    version: '2026.1',
    timezone: 'Europe/London',
    provenance: 'SYNTHETIC',
    packSource: null,
    packRetrievedAt: null,
    basisStrategy: 'CONSIDERATION_ONLY',
    requiredAttributes: [],
    components: [
      { code: 'FEE', label: 'Fee', kind: 'FLAT', amountMinor: '65000' },
    ],
    ...overrides,
  }
}

describe('parseRulePack defaults', () => {
  it('defaults an omitted condition to always', () => {
    const pack = parseRulePack(validPack(), 'test.json')
    expect(pack.components[0]?.condition).toEqual({ op: 'always' })
  })

  it('defaults rounding to HALF_UP and the step to one minor unit', () => {
    const pack = parseRulePack(validPack(), 'test.json')
    expect(pack.components[0]?.rounding).toBe('HALF_UP')
    expect(pack.components[0]?.roundToStepMinor).toBe('1')
  })

  it('defaults optional bounds and modifiers to null', () => {
    const pack = parseRulePack(validPack(), 'test.json')
    const component = pack.components[0]
    expect(component?.minAmountMinor).toBeNull()
    expect(component?.maxAmountMinor).toBeNull()
    expect(component?.kind === 'FLAT' && component.timesAttribute).toBeNull()
  })
})

describe('provenance guard (FR-10)', () => {
  it('accepts a SYNTHETIC pack with no citation', () => {
    expect(() => parseRulePack(validPack({ provenance: 'SYNTHETIC' }), 'test.json')).not.toThrow()
  })

  it('rejects a SOURCED pack with no citation URL', () => {
    expect(() =>
      parseRulePack(
        validPack({ provenance: 'SOURCED', packSource: null, packRetrievedAt: '2026-01-01' }),
        'test.json',
      ),
    ).toThrow(/packSource/)
  })

  it('rejects a SOURCED pack with no retrieval date', () => {
    expect(() =>
      parseRulePack(
        validPack({ provenance: 'SOURCED', packSource: 'https://example.gov', packRetrievedAt: null }),
        'test.json',
      ),
    ).toThrow(/packRetrievedAt/)
  })

  it('rejects an unmarked provenance — there is no third state', () => {
    expect(() => parseRulePack(validPack({ provenance: undefined }), 'test.json')).toThrow(
      InvalidRulePackError,
    )
    expect(() => parseRulePack(validPack({ provenance: 'UNKNOWN' }), 'test.json')).toThrow(
      InvalidRulePackError,
    )
  })
})

describe('structural validation', () => {
  it('names the source file in the error, so a boot failure is actionable', () => {
    expect(() => parseRulePack(validPack({ currency: 'XYZ' }), 'GB-ENG-2026.1.json')).toThrow(
      /GB-ENG-2026\.1\.json/,
    )
  })

  it('rejects an unknown currency', () => {
    expect(() => parseRulePack(validPack({ currency: 'XYZ' }), 'test.json')).toThrow(
      InvalidRulePackError,
    )
  })

  it('rejects a pack with no components', () => {
    expect(() => parseRulePack(validPack({ components: [] }), 'test.json')).toThrow(/component/i)
  })

  it('rejects duplicate component codes, which would make a breakdown ambiguous', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [
            { code: 'FEE', label: 'A', kind: 'FLAT', amountMinor: '1' },
            { code: 'FEE', label: 'B', kind: 'FLAT', amountMinor: '2' },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/duplicate/i)
  })

  it('rejects unknown fields rather than ignoring a typo', () => {
    expect(() => parseRulePack(validPack({ basisStratergy: 'MARKET_ONLY' }), 'test.json')).toThrow(
      InvalidRulePackError,
    )
  })

  it('rejects a non-integer ratePpm', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [{ code: 'D', label: 'D', kind: 'PROPORTIONAL', ratePpm: 4.5 }],
        }),
        'test.json',
      ),
    ).toThrow(InvalidRulePackError)
  })

  it('rejects a float-looking amountMinor', () => {
    expect(() =>
      parseRulePack(
        validPack({ components: [{ code: 'F', label: 'F', kind: 'FLAT', amountMinor: '650.00' }] }),
        'test.json',
      ),
    ).toThrow(InvalidRulePackError)
  })

  it('rejects bands that are not strictly ascending', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [
            {
              code: 'B',
              label: 'B',
              kind: 'PROGRESSIVE_BANDS',
              bands: [
                { upToMinor: '30000000', ratePpm: 20000 },
                { upToMinor: '15000000', ratePpm: 30000 },
              ],
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/ascending/i)
  })

  it('rejects a bounded final band, because value above it would be uncharged', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [
            {
              code: 'B',
              label: 'B',
              kind: 'PROGRESSIVE_BANDS',
              bands: [{ upToMinor: '15000000', ratePpm: 0 }],
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/final band/i)
  })

  it('rejects a min above a max', () => {
    expect(() =>
      parseRulePack(
        validPack({
          components: [
            {
              code: 'F',
              label: 'F',
              kind: 'FLAT',
              amountMinor: '100',
              minAmountMinor: '900',
              maxAmountMinor: '100',
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/minAmountMinor/)
  })

  it('rejects a component referencing an attribute the pack never declares', () => {
    expect(() =>
      parseRulePack(
        validPack({
          requiredAttributes: [],
          components: [
            {
              code: 'M',
              label: 'M',
              kind: 'PROPORTIONAL',
              ratePpm: 2500,
              basisAttribute: 'loanAmountMinor',
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/loanAmountMinor/)
  })

  it('rejects a condition referencing an undeclared attribute', () => {
    expect(() =>
      parseRulePack(
        validPack({
          requiredAttributes: [],
          components: [
            {
              code: 'F',
              label: 'F',
              kind: 'FLAT',
              amountMinor: '1',
              condition: { op: 'eq', attribute: 'county', value: 'Alameda' },
            },
          ],
        }),
        'test.json',
      ),
    ).toThrow(/county/)
  })

  it('accepts a declared attribute used by a condition and a basis', () => {
    expect(() =>
      parseRulePack(
        validPack({
          requiredAttributes: [
            { name: 'county', kind: 'string', label: 'County', options: ['Alameda'] },
            { name: 'loanAmountMinor', kind: 'number', label: 'Loan amount' },
          ],
          components: [
            {
              code: 'M',
              label: 'M',
              kind: 'PROPORTIONAL',
              ratePpm: 2500,
              basisAttribute: 'loanAmountMinor',
              condition: { op: 'eq', attribute: 'county', value: 'Alameda' },
            },
          ],
        }),
        'test.json',
      ),
    ).not.toThrow()
  })

  it('accepts a nested all-of condition', () => {
    const pack = parseRulePack(
      validPack({
        requiredAttributes: [
          { name: 'firstTimeBuyer', kind: 'boolean', label: 'First-time buyer' },
        ],
        components: [
          {
            code: 'R',
            label: 'Relief',
            kind: 'FLAT',
            amountMinor: '1',
            condition: {
              op: 'all',
              of: [
                { op: 'eq', attribute: 'firstTimeBuyer', value: true },
                { op: 'basisLte', amountMinor: '42500000' },
              ],
            },
          },
        ],
      }),
      'test.json',
    )
    expect(pack.components[0]?.condition.op).toBe('all')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/schema.test.ts
```

Expected: FAIL — cannot resolve `../../src/fees/schema.ts`.

- [ ] **Step 4: Write the schema**

`payment-gateway/packages/domain/src/fees/schema.ts`:

```typescript
import { z } from 'zod'
import { CURRENCIES } from '../money/index.ts'
import type {
  Condition,
  FeeComponentRule,
  JurisdictionRulePack,
} from './types.ts'

export class InvalidRulePackError extends Error {
  constructor(sourceLabel: string, detail: string) {
    super(`Invalid jurisdiction rule pack "${sourceLabel}": ${detail}`)
    this.name = 'InvalidRulePackError'
  }
}

const MinorAmountSchema = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative decimal integer string of minor units')

const RatePpmSchema = z
  .number()
  .int('ratePpm must be an integer number of parts-per-million')
  .min(0)
  .max(1_000_000)

const CurrencyCodeSchema = z.enum(
  Object.keys(CURRENCIES) as [keyof typeof CURRENCIES, ...Array<keyof typeof CURRENCIES>],
)

const RoundingModeSchema = z.enum(['HALF_UP', 'HALF_EVEN', 'CEIL', 'FLOOR'])

const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean()])

const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('always') }),
    z.strictObject({
      op: z.literal('eq'),
      attribute: z.string().min(1),
      value: AttributeValueSchema,
    }),
    z.strictObject({ op: z.literal('lte'), attribute: z.string().min(1), value: z.number() }),
    z.strictObject({ op: z.literal('gte'), attribute: z.string().min(1), value: z.number() }),
    z.strictObject({ op: z.literal('basisLte'), amountMinor: MinorAmountSchema }),
    z.strictObject({ op: z.literal('basisGte'), amountMinor: MinorAmountSchema }),
    z.strictObject({ op: z.literal('not'), of: ConditionSchema }),
    z.strictObject({ op: z.literal('all'), of: z.array(ConditionSchema).min(1) }),
    z.strictObject({ op: z.literal('any'), of: z.array(ConditionSchema).min(1) }),
  ]),
)

const componentBase = {
  code: z.string().min(1).regex(/^[A-Z0-9_]+$/, 'component code must be UPPER_SNAKE_CASE'),
  label: z.string().min(1),
  condition: ConditionSchema.default({ op: 'always' }),
  rounding: RoundingModeSchema.default('HALF_UP'),
  roundToStepMinor: MinorAmountSchema.refine((v) => v !== '0', 'step must be positive').default('1'),
  minAmountMinor: MinorAmountSchema.nullable().default(null),
  maxAmountMinor: MinorAmountSchema.nullable().default(null),
}

const BandSchema = z.strictObject({
  upToMinor: MinorAmountSchema.nullable(),
  ratePpm: RatePpmSchema,
})

const FlatRuleSchema = z.strictObject({
  ...componentBase,
  kind: z.literal('FLAT'),
  amountMinor: MinorAmountSchema,
  timesAttribute: z.string().min(1).nullable().default(null),
})

const ProportionalRuleSchema = z.strictObject({
  ...componentBase,
  kind: z.literal('PROPORTIONAL'),
  ratePpm: RatePpmSchema,
  basisAttribute: z.string().min(1).nullable().default(null),
})

const ProgressiveBandsRuleSchema = z
  .strictObject({
    ...componentBase,
    kind: z.literal('PROGRESSIVE_BANDS'),
    bands: z.array(BandSchema).min(1),
  })
  .superRefine((rule, ctx) => {
    let previous = -1n
    rule.bands.forEach((band, index) => {
      const isFinal = index === rule.bands.length - 1
      if (band.upToMinor === null) {
        if (!isFinal) {
          ctx.addIssue({
            code: 'custom',
            path: ['bands', index, 'upToMinor'],
            message: 'only the final band may be unbounded',
          })
        }
        return
      }
      if (isFinal) {
        ctx.addIssue({
          code: 'custom',
          path: ['bands', index, 'upToMinor'],
          message:
            'the final band must be unbounded (upToMinor null), otherwise value above it is never charged',
        })
      }
      const bound = BigInt(band.upToMinor)
      if (bound <= previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['bands', index, 'upToMinor'],
          message: 'band bounds must be strictly ascending',
        })
      }
      previous = bound
    })
  })

const ComponentSchema = z
  .discriminatedUnion('kind', [
    FlatRuleSchema,
    ProportionalRuleSchema,
    ProgressiveBandsRuleSchema,
  ])
  .superRefine((rule, ctx) => {
    if (
      rule.minAmountMinor !== null &&
      rule.maxAmountMinor !== null &&
      BigInt(rule.minAmountMinor) > BigInt(rule.maxAmountMinor)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['minAmountMinor'],
        message: `minAmountMinor ${rule.minAmountMinor} exceeds maxAmountMinor ${rule.maxAmountMinor}`,
      })
    }
  })

const RequiredAttributeSchema = z.strictObject({
  name: z.string().min(1),
  kind: z.enum(['string', 'number', 'boolean']),
  label: z.string().min(1),
  options: z.array(z.string().min(1)).nullable().default(null),
})

/** Every attribute name a condition tree references. */
function conditionAttributes(condition: Condition, into: Set<string>): void {
  switch (condition.op) {
    case 'eq':
    case 'lte':
    case 'gte':
      into.add(condition.attribute)
      return
    case 'not':
      conditionAttributes(condition.of, into)
      return
    case 'all':
    case 'any':
      for (const child of condition.of) conditionAttributes(child, into)
      return
    case 'always':
    case 'basisLte':
    case 'basisGte':
      return
  }
}

function componentAttributes(rule: FeeComponentRule, into: Set<string>): void {
  conditionAttributes(rule.condition, into)
  if (rule.kind === 'FLAT' && rule.timesAttribute !== null) into.add(rule.timesAttribute)
  if (rule.kind === 'PROPORTIONAL' && rule.basisAttribute !== null) into.add(rule.basisAttribute)
}

const RulePackSchema = z
  .strictObject({
    id: z.string().min(1).regex(/^[A-Z]{2}(-[A-Z]{2,4})?$/, 'id must be ISO 3166 based'),
    jurisdictionLabel: z.string().min(1),
    currency: CurrencyCodeSchema,
    version: z.string().min(1),
    timezone: z.string().min(1),
    provenance: z.enum(['SOURCED', 'SYNTHETIC']),
    packSource: z.string().url().nullable().default(null),
    packRetrievedAt: z.string().min(1).nullable().default(null),
    basisStrategy: z.enum([
      'MAX_OF_MARKET_AND_CONSIDERATION',
      'CONSIDERATION_ONLY',
      'MARKET_ONLY',
    ]),
    requiredAttributes: z.array(RequiredAttributeSchema).default([]),
    components: z.array(ComponentSchema).min(1, 'a pack must declare at least one component'),
  })
  .superRefine((pack, ctx) => {
    // FR-10: provenance is blocking. SOURCED demands a citation.
    if (pack.provenance === 'SOURCED') {
      if (pack.packSource === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['packSource'],
          message: 'a SOURCED pack requires packSource, a citation URL',
        })
      }
      if (pack.packRetrievedAt === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['packRetrievedAt'],
          message: 'a SOURCED pack requires packRetrievedAt',
        })
      }
    }

    const seen = new Set<string>()
    for (const component of pack.components) {
      if (seen.has(component.code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['components'],
          message: `duplicate component code "${component.code}"`,
        })
      }
      seen.add(component.code)
    }

    // Every attribute a component references must be declared, so form
    // generation and validation stay derivable from the pack alone (FR-2).
    const declared = new Set(pack.requiredAttributes.map((attribute) => attribute.name))
    const referenced = new Set<string>()
    for (const component of pack.components) {
      componentAttributes(component as FeeComponentRule, referenced)
    }
    for (const name of referenced) {
      if (!declared.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['requiredAttributes'],
          message: `component references attribute "${name}", which requiredAttributes does not declare`,
        })
      }
    }
  })

export const JurisdictionRulePackSchema = RulePackSchema as unknown as z.ZodType<JurisdictionRulePack>

export function parseRulePack(raw: unknown, sourceLabel: string): JurisdictionRulePack {
  const result = RulePackSchema.safeParse(raw)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new InvalidRulePackError(sourceLabel, detail)
  }
  return result.data as JurisdictionRulePack
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/schema.test.ts
```

Expected: PASS — 22 tests.

- [ ] **Step 6: Commit**

```bash
git add payment-gateway/packages/domain/src/fees payment-gateway/packages/domain/tests/fees
git commit -m "feat: add rule pack types and Zod schema with blocking provenance guard"
```

---

## Task 8: Condition evaluation and basis strategies

Both are small pure decision functions that the component calculators depend on. They ship together because neither is independently useful and a reviewer would gate them as one change.

**Files:**
- Create: `payment-gateway/packages/domain/src/fees/condition.ts`
- Create: `payment-gateway/packages/domain/src/fees/basis.ts`
- Create: `payment-gateway/packages/domain/tests/fees/condition.test.ts`
- Create: `payment-gateway/packages/domain/tests/fees/basis.test.ts`

**Interfaces:**
- Consumes: `Condition`, `AttributeValue`, `BasisStrategy`, `FeeInput`, `Money`.
- Produces:
  - `class MissingAttributeError extends Error` with `attribute: string`
  - `class AttributeTypeError extends Error` with `attribute: string`
  - `function evaluateCondition(condition: Condition, ctx: ConditionContext): boolean`
  - `interface ConditionContext { attributes: Readonly<Record<string, AttributeValue>>; chargeableValue: Money }`
  - `function describeCondition(condition: Condition): string` — for `appliedRules` text
  - `function resolveChargeableValue(input: FeeInput, strategy: BasisStrategy): Money`

A missing attribute **throws** rather than evaluating false. A silently-false condition would quietly drop a fee component, producing a total that is too low — the worst possible failure direction for a statutory charge.

- [ ] **Step 1: Write the failing condition test**

`payment-gateway/packages/domain/tests/fees/condition.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/index.ts'
import {
  AttributeTypeError,
  MissingAttributeError,
  describeCondition,
  evaluateCondition,
} from '../../src/fees/condition.ts'

const ctx = (
  attributes: Record<string, string | number | boolean>,
  chargeableMinor = 39500000n,
) => ({ attributes, chargeableValue: Money.of(chargeableMinor, 'GBP') })

describe('evaluateCondition', () => {
  it('always is true', () => {
    expect(evaluateCondition({ op: 'always' }, ctx({}))).toBe(true)
  })

  it('eq matches a string, a number and a boolean', () => {
    expect(
      evaluateCondition({ op: 'eq', attribute: 'county', value: 'Alameda' }, ctx({ county: 'Alameda' })),
    ).toBe(true)
    expect(
      evaluateCondition({ op: 'eq', attribute: 'county', value: 'Alameda' }, ctx({ county: 'Marin' })),
    ).toBe(false)
    expect(
      evaluateCondition({ op: 'eq', attribute: 'firstTimeBuyer', value: true }, ctx({ firstTimeBuyer: true })),
    ).toBe(true)
    expect(
      evaluateCondition({ op: 'eq', attribute: 'firstTimeBuyer', value: true }, ctx({ firstTimeBuyer: false })),
    ).toBe(false)
    expect(
      evaluateCondition({ op: 'eq', attribute: 'documentCount', value: 2 }, ctx({ documentCount: 2 })),
    ).toBe(true)
  })

  it('does not coerce across types — "true" is not true', () => {
    expect(
      evaluateCondition({ op: 'eq', attribute: 'firstTimeBuyer', value: true }, ctx({ firstTimeBuyer: 'true' })),
    ).toBe(false)
  })

  it('lte and gte compare numbers inclusively', () => {
    expect(evaluateCondition({ op: 'lte', attribute: 'n', value: 5 }, ctx({ n: 5 }))).toBe(true)
    expect(evaluateCondition({ op: 'lte', attribute: 'n', value: 5 }, ctx({ n: 6 }))).toBe(false)
    expect(evaluateCondition({ op: 'gte', attribute: 'n', value: 5 }, ctx({ n: 5 }))).toBe(true)
    expect(evaluateCondition({ op: 'gte', attribute: 'n', value: 5 }, ctx({ n: 4 }))).toBe(false)
  })

  it('basisLte and basisGte compare the chargeable value inclusively', () => {
    expect(evaluateCondition({ op: 'basisLte', amountMinor: '39500000' }, ctx({}))).toBe(true)
    expect(evaluateCondition({ op: 'basisLte', amountMinor: '39499999' }, ctx({}))).toBe(false)
    expect(evaluateCondition({ op: 'basisGte', amountMinor: '39500000' }, ctx({}))).toBe(true)
    expect(evaluateCondition({ op: 'basisGte', amountMinor: '39500001' }, ctx({}))).toBe(false)
  })

  it('not inverts', () => {
    expect(evaluateCondition({ op: 'not', of: { op: 'always' } }, ctx({}))).toBe(false)
  })

  it('all requires every child', () => {
    const condition = {
      op: 'all' as const,
      of: [
        { op: 'eq' as const, attribute: 'firstTimeBuyer', value: true },
        { op: 'basisLte' as const, amountMinor: '42500000' },
      ],
    }
    expect(evaluateCondition(condition, ctx({ firstTimeBuyer: true }))).toBe(true)
    expect(evaluateCondition(condition, ctx({ firstTimeBuyer: false }))).toBe(false)
    expect(evaluateCondition(condition, ctx({ firstTimeBuyer: true }, 50000000n))).toBe(false)
  })

  it('any requires one child', () => {
    const condition = {
      op: 'any' as const,
      of: [
        { op: 'eq' as const, attribute: 'county', value: 'Alameda' },
        { op: 'eq' as const, attribute: 'county', value: 'Marin' },
      ],
    }
    expect(evaluateCondition(condition, ctx({ county: 'Marin' }))).toBe(true)
    expect(evaluateCondition(condition, ctx({ county: 'Yolo' }))).toBe(false)
  })

  it('THROWS on a missing attribute rather than quietly evaluating false', () => {
    expect(() => evaluateCondition({ op: 'eq', attribute: 'county', value: 'X' }, ctx({}))).toThrow(
      MissingAttributeError,
    )
  })

  it('names the missing attribute', () => {
    expect(() => evaluateCondition({ op: 'eq', attribute: 'county', value: 'X' }, ctx({}))).toThrow(
      /county/,
    )
  })

  it('throws when a numeric comparison receives a non-number', () => {
    expect(() =>
      evaluateCondition({ op: 'lte', attribute: 'n', value: 5 }, ctx({ n: 'five' })),
    ).toThrow(AttributeTypeError)
  })
})

describe('describeCondition', () => {
  it('renders a leaf legibly for the breakdown', () => {
    expect(describeCondition({ op: 'always' })).toBe('always applies')
    expect(describeCondition({ op: 'eq', attribute: 'county', value: 'Alameda' })).toBe(
      'county equals "Alameda"',
    )
    expect(describeCondition({ op: 'basisLte', amountMinor: '42500000' })).toBe(
      'chargeable value at most 42500000 minor units',
    )
  })

  it('renders a compound condition', () => {
    expect(
      describeCondition({
        op: 'all',
        of: [
          { op: 'eq', attribute: 'firstTimeBuyer', value: true },
          { op: 'basisLte', amountMinor: '42500000' },
        ],
      }),
    ).toBe('all of (firstTimeBuyer equals true; chargeable value at most 42500000 minor units)')
  })

  it('renders a negation', () => {
    expect(describeCondition({ op: 'not', of: { op: 'always' } })).toBe('not (always applies)')
  })
})
```

- [ ] **Step 2: Write the failing basis test**

`payment-gateway/packages/domain/tests/fees/basis.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { CurrencyMismatchError, Money } from '../../src/money/index.ts'
import { resolveChargeableValue } from '../../src/fees/basis.ts'
import type { FeeInput } from '../../src/fees/types.ts'

function input(considerationMinor: bigint, marketMinor: bigint, currency = 'INR' as const): FeeInput {
  return {
    jurisdictionId: 'IN-TG',
    propertyType: 'APARTMENT',
    transactionType: 'SALE',
    consideration: Money.of(considerationMinor, currency),
    marketValue: Money.of(marketMinor, currency),
    attributes: {},
  }
}

describe('resolveChargeableValue', () => {
  it('MAX_OF_MARKET_AND_CONSIDERATION takes the higher, whichever it is', () => {
    expect(
      resolveChargeableValue(input(480000000n, 500000000n), 'MAX_OF_MARKET_AND_CONSIDERATION')
        .amountMinor,
    ).toBe(500000000n)
    expect(
      resolveChargeableValue(input(520000000n, 500000000n), 'MAX_OF_MARKET_AND_CONSIDERATION')
        .amountMinor,
    ).toBe(520000000n)
  })

  it('is stable when the two values are equal', () => {
    expect(
      resolveChargeableValue(input(500000000n, 500000000n), 'MAX_OF_MARKET_AND_CONSIDERATION')
        .amountMinor,
    ).toBe(500000000n)
  })

  it('CONSIDERATION_ONLY ignores a higher market value', () => {
    expect(
      resolveChargeableValue(input(480000000n, 500000000n), 'CONSIDERATION_ONLY').amountMinor,
    ).toBe(480000000n)
  })

  it('MARKET_ONLY ignores a higher consideration', () => {
    expect(resolveChargeableValue(input(520000000n, 500000000n), 'MARKET_ONLY').amountMinor).toBe(
      500000000n,
    )
  })

  it('preserves the currency', () => {
    expect(resolveChargeableValue(input(1n, 2n, 'JPY'), 'MARKET_ONLY').currency).toBe('JPY')
  })

  it('throws when the two input amounts are in different currencies', () => {
    const mixed: FeeInput = {
      ...input(1n, 2n),
      marketValue: Money.of(2n, 'GBP'),
    }
    expect(() => resolveChargeableValue(mixed, 'MAX_OF_MARKET_AND_CONSIDERATION')).toThrow(
      CurrencyMismatchError,
    )
  })

  it('rejects a negative chargeable value', () => {
    expect(() => resolveChargeableValue(input(-1n, -1n), 'CONSIDERATION_ONLY')).toThrow(/negative/i)
  })
})
```

The cross-currency case uses `MAX_OF_...` deliberately: `CONSIDERATION_ONLY` never touches `marketValue`, so it would not catch the mismatch. That asymmetry is why the check lives in the strategy function rather than only in `Money.max`.

- [ ] **Step 3: Run both tests to verify they fail**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/condition.test.ts tests/fees/basis.test.ts
```

Expected: FAIL — cannot resolve either module.

- [ ] **Step 4: Write the condition evaluator**

`payment-gateway/packages/domain/src/fees/condition.ts`:

```typescript
import type { Money } from '../money/index.ts'
import type { AttributeValue, Condition } from './types.ts'

export interface ConditionContext {
  readonly attributes: Readonly<Record<string, AttributeValue>>
  readonly chargeableValue: Money
}

export class MissingAttributeError extends Error {
  constructor(readonly attribute: string) {
    super(
      `Fee input is missing attribute "${attribute}", which a rule condition requires. ` +
        'A missing attribute is an error, never a false condition — silently dropping a ' +
        'fee component would under-charge a statutory fee.',
    )
    this.name = 'MissingAttributeError'
  }
}

export class AttributeTypeError extends Error {
  constructor(readonly attribute: string, expected: string, received: unknown) {
    super(
      `Attribute "${attribute}" must be a ${expected}, received ${typeof received} (${String(received)})`,
    )
    this.name = 'AttributeTypeError'
  }
}

function readAttribute(ctx: ConditionContext, name: string): AttributeValue {
  if (!Object.hasOwn(ctx.attributes, name)) throw new MissingAttributeError(name)
  const value = ctx.attributes[name]
  if (value === undefined) throw new MissingAttributeError(name)
  return value
}

function readNumericAttribute(ctx: ConditionContext, name: string): number {
  const value = readAttribute(ctx, name)
  if (typeof value !== 'number') throw new AttributeTypeError(name, 'number', value)
  return value
}

export function evaluateCondition(condition: Condition, ctx: ConditionContext): boolean {
  switch (condition.op) {
    case 'always':
      return true
    case 'eq': {
      const value = readAttribute(ctx, condition.attribute)
      // Strict identity: no coercion, so "true" never equals true.
      return value === condition.value
    }
    case 'lte':
      return readNumericAttribute(ctx, condition.attribute) <= condition.value
    case 'gte':
      return readNumericAttribute(ctx, condition.attribute) >= condition.value
    case 'basisLte':
      return ctx.chargeableValue.amountMinor <= BigInt(condition.amountMinor)
    case 'basisGte':
      return ctx.chargeableValue.amountMinor >= BigInt(condition.amountMinor)
    case 'not':
      return !evaluateCondition(condition.of, ctx)
    case 'all':
      return condition.of.every((child) => evaluateCondition(child, ctx))
    case 'any':
      return condition.of.some((child) => evaluateCondition(child, ctx))
  }
}

function renderValue(value: AttributeValue): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

/** Human-readable rendering used in FeeBreakdown.appliedRules (FR-5). */
export function describeCondition(condition: Condition): string {
  switch (condition.op) {
    case 'always':
      return 'always applies'
    case 'eq':
      return `${condition.attribute} equals ${renderValue(condition.value)}`
    case 'lte':
      return `${condition.attribute} at most ${condition.value}`
    case 'gte':
      return `${condition.attribute} at least ${condition.value}`
    case 'basisLte':
      return `chargeable value at most ${condition.amountMinor} minor units`
    case 'basisGte':
      return `chargeable value at least ${condition.amountMinor} minor units`
    case 'not':
      return `not (${describeCondition(condition.of)})`
    case 'all':
      return `all of (${condition.of.map(describeCondition).join('; ')})`
    case 'any':
      return `any of (${condition.of.map(describeCondition).join('; ')})`
  }
}
```

- [ ] **Step 5: Write the basis resolver**

`payment-gateway/packages/domain/src/fees/basis.ts`:

```typescript
import { Money } from '../money/index.ts'
import type { BasisStrategy, FeeInput } from './types.ts'

/**
 * Decide the value the fees are charged on (FR-3).
 *
 * Jurisdictions differ genuinely here — India charges on the higher of
 * market value and price paid, England and Dubai on the price paid. The
 * pack names the strategy; the engine applies the named one and never
 * branches on a jurisdiction id.
 */
export function resolveChargeableValue(input: FeeInput, strategy: BasisStrategy): Money {
  const value = selectValue(input, strategy)
  if (value.isNegative()) {
    throw new RangeError(
      `Chargeable value is negative (${value.toString()}) under strategy ${strategy}`,
    )
  }
  return value
}

function selectValue(input: FeeInput, strategy: BasisStrategy): Money {
  switch (strategy) {
    case 'MAX_OF_MARKET_AND_CONSIDERATION':
      // Money.max throws on a currency mismatch, which is the guard for
      // an input assembled from two differently-denominated sources.
      return Money.max(input.marketValue, input.consideration)
    case 'CONSIDERATION_ONLY':
      return input.consideration
    case 'MARKET_ONLY':
      return input.marketValue
  }
}
```

- [ ] **Step 6: Run both tests to verify they pass**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/condition.test.ts tests/fees/basis.test.ts
```

Expected: PASS — 15 condition tests, 7 basis tests.

- [ ] **Step 7: Commit**

```bash
git add payment-gateway/packages/domain/src/fees/condition.ts payment-gateway/packages/domain/src/fees/basis.ts payment-gateway/packages/domain/tests/fees/condition.test.ts payment-gateway/packages/domain/tests/fees/basis.test.ts
git commit -m "feat: add condition evaluation and named basis strategies"
```

---

## Task 9: Component calculators

The three component kinds from FR-4. Band boundaries are the highest-risk arithmetic in the whole plan, so the test pins one minor unit below, exactly at, and one above every bound.

**Files:**
- Create: `payment-gateway/packages/domain/src/fees/components.ts`
- Create: `payment-gateway/packages/domain/tests/fees/components.test.ts`

**Interfaces:**
- Consumes: `Money`, `RoundingMode`, the rule types, `evaluateCondition`, `describeCondition`, `MissingAttributeError`, `AttributeTypeError`.
- Produces:
  - `interface ComponentComputation { amount: Money; basis: Money | null; ratePpm: number | null; bands: ComputedBand[] | null; appliedRules: AppliedRule[] }`
  - `function computeComponent(rule: FeeComponentRule, ctx: ComponentContext): ComponentComputation | null` — returns `null` when the condition excludes the component
  - `interface ComponentContext { chargeableValue: Money; attributes: Readonly<Record<string, AttributeValue>> }`

`computeComponent` returning `null` rather than a zero amount is deliberate: a component that did not apply and a component that computed to zero are different facts, and the breakdown shows both distinctly (the England screen shows "First-time buyer relief — not applied" with an em dash, not "£0.00").

- [ ] **Step 1: Write the failing test**

`payment-gateway/packages/domain/tests/fees/components.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/index.ts'
import { computeComponent } from '../../src/fees/components.ts'
import type { FeeComponentRule } from '../../src/fees/types.ts'

const gbp = (minor: bigint) => Money.of(minor, 'GBP')

/** Fill in the schema defaults a hand-written rule literal would omit. */
function rule(partial: Partial<FeeComponentRule> & Pick<FeeComponentRule, 'kind'>): FeeComponentRule {
  return {
    code: 'TEST',
    label: 'Test',
    condition: { op: 'always' },
    rounding: 'HALF_UP',
    roundToStepMinor: '1',
    minAmountMinor: null,
    maxAmountMinor: null,
    ...(partial.kind === 'FLAT' ? { amountMinor: '0', timesAttribute: null } : {}),
    ...(partial.kind === 'PROPORTIONAL' ? { ratePpm: 0, basisAttribute: null } : {}),
    ...(partial.kind === 'PROGRESSIVE_BANDS' ? { bands: [{ upToMinor: null, ratePpm: 0 }] } : {}),
    ...partial,
  } as FeeComponentRule
}

const ctx = (chargeableMinor: bigint, attributes: Record<string, string | number | boolean> = {}) => ({
  chargeableValue: gbp(chargeableMinor),
  attributes,
})

describe('conditional application', () => {
  it('returns null when the condition excludes the component', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '65000', condition: { op: 'eq', attribute: 'ftb', value: true } }),
      ctx(39500000n, { ftb: false }),
    )
    expect(result).toBeNull()
  })

  it('computes when the condition includes it', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '65000', condition: { op: 'eq', attribute: 'ftb', value: true } }),
      ctx(39500000n, { ftb: true }),
    )
    expect(result?.amount.amountMinor).toBe(65000n)
  })

  it('records the condition it satisfied in appliedRules', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '1', condition: { op: 'basisLte', amountMinor: '99999999' } }),
      ctx(39500000n),
    )
    expect(result?.appliedRules.map((r) => r.code)).toContain('CONDITION')
    expect(result?.appliedRules.find((r) => r.code === 'CONDITION')?.detail).toMatch(
      /chargeable value at most/,
    )
  })
})

describe('FLAT', () => {
  it('charges a fixed amount and reports no basis or rate', () => {
    const result = computeComponent(rule({ kind: 'FLAT', amountMinor: '65000' }), ctx(39500000n))
    expect(result?.amount.amountMinor).toBe(65000n)
    expect(result?.basis).toBeNull()
    expect(result?.ratePpm).toBeNull()
    expect(result?.bands).toBeNull()
  })

  it('multiplies by a numeric attribute for a per-document fee', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '4750', timesAttribute: 'documentCount' }),
      ctx(85000000n, { documentCount: 2 }),
    )
    expect(result?.amount.amountMinor).toBe(9500n)
  })

  it('records the multiplier in appliedRules', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '4750', timesAttribute: 'documentCount' }),
      ctx(85000000n, { documentCount: 2 }),
    )
    expect(result?.appliedRules.map((r) => r.detail).join(' ')).toMatch(/documentCount.*2/)
  })

  it('throws when the multiplier attribute is missing', () => {
    expect(() =>
      computeComponent(
        rule({ kind: 'FLAT', amountMinor: '4750', timesAttribute: 'documentCount' }),
        ctx(85000000n),
      ),
    ).toThrow(/documentCount/)
  })

  it('throws when the multiplier is not a non-negative integer', () => {
    expect(() =>
      computeComponent(
        rule({ kind: 'FLAT', amountMinor: '10', timesAttribute: 'n' }),
        ctx(1n, { n: 1.5 }),
      ),
    ).toThrow(/integer/i)
    expect(() =>
      computeComponent(rule({ kind: 'FLAT', amountMinor: '10', timesAttribute: 'n' }), ctx(1n, { n: -1 })),
    ).toThrow(/negative/i)
  })

  it('yields zero for a multiplier of zero, which is applied-and-zero, not absent', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '4750', timesAttribute: 'documentCount' }),
      ctx(1n, { documentCount: 0 }),
    )
    expect(result).not.toBeNull()
    expect(result?.amount.amountMinor).toBe(0n)
  })
})

describe('PROPORTIONAL', () => {
  it('applies a rate to the chargeable value', () => {
    // 0.11% of 85,000,000 minor = 93,500 minor
    const result = computeComponent(rule({ kind: 'PROPORTIONAL', ratePpm: 1100 }), ctx(85000000n))
    expect(result?.amount.amountMinor).toBe(93500n)
    expect(result?.basis?.amountMinor).toBe(85000000n)
    expect(result?.ratePpm).toBe(1100)
  })

  it('applies a rate to a named attribute basis instead, for a mortgage fee', () => {
    // 0.25% of a 180,000,000 minor loan = 450,000 minor
    const result = computeComponent(
      rule({ kind: 'PROPORTIONAL', ratePpm: 2500, basisAttribute: 'loanAmountMinor' }),
      ctx(240000000n, { loanAmountMinor: 180000000 }),
    )
    expect(result?.amount.amountMinor).toBe(450000n)
    expect(result?.basis?.amountMinor).toBe(180000000n)
  })

  it('throws when the basis attribute is missing or not a non-negative integer', () => {
    expect(() =>
      computeComponent(
        rule({ kind: 'PROPORTIONAL', ratePpm: 2500, basisAttribute: 'loanAmountMinor' }),
        ctx(1n),
      ),
    ).toThrow(/loanAmountMinor/)
    expect(() =>
      computeComponent(
        rule({ kind: 'PROPORTIONAL', ratePpm: 2500, basisAttribute: 'loan' }),
        ctx(1n, { loan: 1.5 }),
      ),
    ).toThrow(/integer/i)
  })

  it('records the rate and basis in appliedRules', () => {
    const result = computeComponent(rule({ kind: 'PROPORTIONAL', ratePpm: 40000 }), ctx(500000000n))
    const text = result?.appliedRules.map((r) => r.detail).join(' ') ?? ''
    expect(text).toMatch(/40000 ppm/)
  })
})

describe('PROGRESSIVE_BANDS', () => {
  /** England-shaped: 0% to 150k, 2% to 300k, 3% above. Amounts in pence. */
  const englandBands = rule({
    kind: 'PROGRESSIVE_BANDS',
    bands: [
      { upToMinor: '15000000', ratePpm: 0 },
      { upToMinor: '30000000', ratePpm: 20000 },
      { upToMinor: null, ratePpm: 30000 },
    ],
  })

  it('charges each band only on its own slice', () => {
    // 395,000.00 -> 0 + (150,000 @ 2% = 3,000) + (95,000 @ 3% = 2,850) = 5,850
    const result = computeComponent(englandBands, ctx(39500000n))
    expect(result?.amount.amountMinor).toBe(585000n)
  })

  it('reports every band it walked, including the untouched ones', () => {
    const result = computeComponent(englandBands, ctx(39500000n))
    expect(result?.bands).toHaveLength(3)
    expect(result?.bands?.[0]).toMatchObject({
      fromMinor: '0',
      toMinor: '15000000',
      slicedMinor: '15000000',
      ratePpm: 0,
    })
    expect(result?.bands?.[1]?.slicedMinor).toBe('15000000')
    expect(result?.bands?.[2]?.slicedMinor).toBe('9500000')
    expect(result?.bands?.[2]?.toMinor).toBeNull()
  })

  it('is exact one minor unit BELOW a bound', () => {
    // 149,999.99 -> entirely in the 0% band
    expect(computeComponent(englandBands, ctx(14999999n))?.amount.amountMinor).toBe(0n)
  })

  it('is exact exactly AT a bound', () => {
    // 150,000.00 -> still entirely 0%, because the bound is inclusive
    expect(computeComponent(englandBands, ctx(15000000n))?.amount.amountMinor).toBe(0n)
  })

  it('is exact one minor unit ABOVE a bound', () => {
    // 150,000.01 -> one pence in the 2% band, rounding HALF_UP to 0
    const result = computeComponent(englandBands, ctx(15000001n))
    expect(result?.bands?.[1]?.slicedMinor).toBe('1')
    expect(result?.amount.amountMinor).toBe(0n)
  })

  it('is exact at the second bound and just above it', () => {
    // 300,000.00 -> 150,000 @ 2% = 3,000.00
    expect(computeComponent(englandBands, ctx(30000000n))?.amount.amountMinor).toBe(300000n)
    // 300,000.01 -> 3,000.00 plus one pence at 3%, HALF_UP to 0
    expect(computeComponent(englandBands, ctx(30000001n))?.amount.amountMinor).toBe(300000n)
  })

  it('charges nothing on a zero chargeable value', () => {
    const result = computeComponent(englandBands, ctx(0n))
    expect(result?.amount.amountMinor).toBe(0n)
    expect(result?.bands?.every((band) => band.slicedMinor === '0')).toBe(true)
  })

  it('rounds the band total once, not each band, and reports no single rate', () => {
    const result = computeComponent(englandBands, ctx(39500000n))
    expect(result?.ratePpm).toBeNull()
    expect(result?.basis?.amountMinor).toBe(39500000n)
  })

  it('walks a Singapore-shaped four-band schedule exactly', () => {
    // 1% to 180k, 2% to 360k, 3% to 1,000k, 4% above, on 1,500,000.00
    const sgBands = rule({
      kind: 'PROGRESSIVE_BANDS',
      bands: [
        { upToMinor: '18000000', ratePpm: 10000 },
        { upToMinor: '36000000', ratePpm: 20000 },
        { upToMinor: '100000000', ratePpm: 30000 },
        { upToMinor: null, ratePpm: 40000 },
      ],
    })
    // 180,000 + 360,000 + 1,920,000 + 2,000,000 = 4,460,000 minor
    expect(computeComponent(sgBands, ctx(150000000n))?.amount.amountMinor).toBe(4460000n)
  })
})

describe('bounds and rounding', () => {
  it('applies a minimum', () => {
    const result = computeComponent(
      rule({ kind: 'PROPORTIONAL', ratePpm: 1100, minAmountMinor: '1000' }),
      ctx(10000n),
    )
    // 0.11% of 10,000 = 11, raised to the 1,000 minimum
    expect(result?.amount.amountMinor).toBe(1000n)
  })

  it('applies a maximum', () => {
    const result = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '3750', timesAttribute: 'n', maxAmountMinor: '22500' }),
      ctx(1n, { n: 10 }),
    )
    // 37,500 capped at 22,500
    expect(result?.amount.amountMinor).toBe(22500n)
  })

  it('records a bound in appliedRules only when it actually bound', () => {
    const bound = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '37500', maxAmountMinor: '22500' }),
      ctx(1n),
    )
    expect(bound?.appliedRules.map((r) => r.code)).toContain('MAX_APPLIED')

    const unbound = computeComponent(
      rule({ kind: 'FLAT', amountMinor: '7500', maxAmountMinor: '22500' }),
      ctx(1n),
    )
    expect(unbound?.appliedRules.map((r) => r.code)).not.toContain('MAX_APPLIED')
  })

  it('rounds to a coarser step when the pack asks', () => {
    // 4% of 1,234,567 = 49,382.68 -> CEIL to the whole major unit (step 100)
    const result = computeComponent(
      rule({ kind: 'PROPORTIONAL', ratePpm: 40000, roundToStepMinor: '100', rounding: 'CEIL' }),
      ctx(1234567n),
    )
    expect(result?.amount.amountMinor).toBe(49400n)
  })

  it('records the rounding it performed', () => {
    const result = computeComponent(
      rule({ kind: 'PROPORTIONAL', ratePpm: 40000, roundToStepMinor: '100', rounding: 'CEIL' }),
      ctx(1234567n),
    )
    expect(result?.appliedRules.map((r) => r.code)).toContain('ROUNDING')
    expect(result?.appliedRules.find((r) => r.code === 'ROUNDING')?.detail).toMatch(/CEIL/)
  })

  it('applies the minimum after rounding, not before', () => {
    const result = computeComponent(
      rule({
        kind: 'PROPORTIONAL',
        ratePpm: 1,
        rounding: 'FLOOR',
        roundToStepMinor: '1',
        minAmountMinor: '500',
      }),
      ctx(100n),
    )
    // 1 ppm of 100 = 0.0001 -> FLOOR 0 -> raised to 500
    expect(result?.amount.amountMinor).toBe(500n)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/components.test.ts
```

Expected: FAIL — cannot resolve `../../src/fees/components.ts`.

- [ ] **Step 3: Write the implementation**

`payment-gateway/packages/domain/src/fees/components.ts`:

```typescript
import { Money } from '../money/index.ts'
import {
  AttributeTypeError,
  MissingAttributeError,
  describeCondition,
  evaluateCondition,
} from './condition.ts'
import type {
  AppliedRule,
  AttributeValue,
  ComputedBand,
  FeeComponentRule,
} from './types.ts'

export interface ComponentContext {
  readonly chargeableValue: Money
  readonly attributes: Readonly<Record<string, AttributeValue>>
}

export interface ComponentComputation {
  readonly amount: Money
  readonly basis: Money | null
  readonly ratePpm: number | null
  readonly bands: readonly ComputedBand[] | null
  readonly appliedRules: readonly AppliedRule[]
}

function readNonNegativeInteger(
  attributes: Readonly<Record<string, AttributeValue>>,
  name: string,
): bigint {
  if (!Object.hasOwn(attributes, name)) throw new MissingAttributeError(name)
  const value = attributes[name]
  if (typeof value !== 'number') throw new AttributeTypeError(name, 'number', value)
  if (!Number.isInteger(value)) {
    throw new AttributeTypeError(name, 'integer', value)
  }
  if (value < 0) {
    throw new AttributeTypeError(name, 'non-negative integer', value)
  }
  return BigInt(value)
}

/**
 * Compute one fee component, or return null when its condition excludes it.
 *
 * Null and a zero amount are different facts: "relief not applied" and
 * "relief applied, worth nothing" render differently in a breakdown, and
 * only the caller knows which it is looking at.
 */
export function computeComponent(
  rule: FeeComponentRule,
  ctx: ComponentContext,
): ComponentComputation | null {
  const conditionContext = {
    attributes: ctx.attributes,
    chargeableValue: ctx.chargeableValue,
  }
  if (!evaluateCondition(rule.condition, conditionContext)) return null

  const appliedRules: AppliedRule[] = [
    { code: 'CONDITION', detail: describeCondition(rule.condition) },
  ]

  const currency = ctx.chargeableValue.currency
  let raw: Money
  let basis: Money | null = null
  let ratePpm: number | null = null
  let bands: ComputedBand[] | null = null

  switch (rule.kind) {
    case 'FLAT': {
      const unit = Money.of(BigInt(rule.amountMinor), currency)
      if (rule.timesAttribute === null) {
        raw = unit
        appliedRules.push({
          code: 'FLAT',
          detail: `flat ${rule.amountMinor} minor units`,
        })
      } else {
        const multiplier = readNonNegativeInteger(ctx.attributes, rule.timesAttribute)
        raw = Money.of(unit.amountMinor * multiplier, currency)
        appliedRules.push({
          code: 'FLAT',
          detail: `flat ${rule.amountMinor} minor units times ${rule.timesAttribute} = ${multiplier}`,
        })
      }
      break
    }

    case 'PROPORTIONAL': {
      basis =
        rule.basisAttribute === null
          ? ctx.chargeableValue
          : Money.of(readNonNegativeInteger(ctx.attributes, rule.basisAttribute), currency)
      raw = basis.multiplyPpm(rule.ratePpm, rule.rounding)
      ratePpm = rule.ratePpm
      appliedRules.push({
        code: 'PROPORTIONAL',
        detail:
          `${rule.ratePpm} ppm of ${basis.amountMinor} minor units` +
          (rule.basisAttribute === null ? '' : ` (basis attribute ${rule.basisAttribute})`),
      })
      break
    }

    case 'PROGRESSIVE_BANDS': {
      basis = ctx.chargeableValue
      const walked = walkBands(rule.bands, basis, rule.rounding)
      bands = walked.bands
      raw = walked.total
      appliedRules.push({
        code: 'PROGRESSIVE_BANDS',
        detail: `${rule.bands.length} marginal bands walked over ${basis.amountMinor} minor units`,
      })
      break
    }
  }

  // Round, then bound. Rounding first means a minimum is expressed in the
  // same granularity the pack rounds to (FR-7).
  const step = BigInt(rule.roundToStepMinor)
  const rounded = raw.roundTo(step, rule.rounding)
  if (rounded.amountMinor !== raw.amountMinor || step !== 1n) {
    appliedRules.push({
      code: 'ROUNDING',
      detail: `${rule.rounding} to a step of ${rule.roundToStepMinor} minor units`,
    })
  }

  const min = rule.minAmountMinor === null ? null : Money.of(BigInt(rule.minAmountMinor), currency)
  const max = rule.maxAmountMinor === null ? null : Money.of(BigInt(rule.maxAmountMinor), currency)
  const bounded = rounded.clamp(min, max)

  if (min !== null && bounded.amountMinor > rounded.amountMinor) {
    appliedRules.push({
      code: 'MIN_APPLIED',
      detail: `raised to the minimum of ${rule.minAmountMinor} minor units`,
    })
  }
  if (max !== null && bounded.amountMinor < rounded.amountMinor) {
    appliedRules.push({
      code: 'MAX_APPLIED',
      detail: `capped at the maximum of ${rule.maxAmountMinor} minor units`,
    })
  }

  return { amount: bounded, basis, ratePpm, bands, appliedRules }
}

interface WalkedBands {
  readonly bands: ComputedBand[]
  readonly total: Money
}

/**
 * Walk marginal bands. Each band charges only the slice of value that
 * falls inside it, so a bound is inclusive of its own band and exclusive
 * of the next.
 */
function walkBands(
  bands: readonly { upToMinor: string | null; ratePpm: number }[],
  basis: Money,
  rounding: Parameters<Money['multiplyPpm']>[1],
): WalkedBands {
  const currency = basis.currency
  const computed: ComputedBand[] = []
  const parts: Money[] = []
  let lowerBound = 0n

  for (const band of bands) {
    const upperBound = band.upToMinor === null ? basis.amountMinor : BigInt(band.upToMinor)
    const cappedUpper = upperBound < basis.amountMinor ? upperBound : basis.amountMinor
    const sliced = cappedUpper > lowerBound ? cappedUpper - lowerBound : 0n
    const sliceAmount = Money.of(sliced, currency).multiplyPpm(band.ratePpm, rounding)

    computed.push({
      fromMinor: lowerBound.toString(),
      toMinor: band.upToMinor,
      slicedMinor: sliced.toString(),
      ratePpm: band.ratePpm,
      amount: { amountMinor: sliceAmount.amountMinor.toString(), currency },
    })
    parts.push(sliceAmount)

    if (band.upToMinor !== null) lowerBound = BigInt(band.upToMinor)
  }

  return { bands: computed, total: Money.sum(parts, currency) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/components.test.ts
```

Expected: PASS — 27 tests.

- [ ] **Step 5: Commit**

```bash
git add payment-gateway/packages/domain/src/fees/components.ts payment-gateway/packages/domain/tests/fees/components.test.ts
git commit -m "feat: add flat, proportional and progressive band component calculators"
```

---

## Task 10: computeFee orchestration

The function the whole plan exists to deliver (FR-1, FR-5). Pure: no I/O, no clock, no randomness.

**Files:**
- Create: `payment-gateway/packages/domain/src/fees/compute.ts`
- Create: `payment-gateway/packages/domain/tests/fees/compute.test.ts`

**Interfaces:**
- Consumes: `resolveChargeableValue`, `computeComponent`, `Money`, `toWire`, the types.
- Produces:
  - `const SYNTHETIC_DISCLAIMER: string`
  - `const SOURCED_DISCLAIMER: string`
  - `class FeeInputError extends Error`
  - `function computeFee(input: FeeInput, pack: JurisdictionRulePack): FeeBreakdown`
  - `function validateFeeInput(input: FeeInput, pack: JurisdictionRulePack): void` — throws `FeeInputError`; exported so the HTTP layer in plan 2 can validate before computing

- [ ] **Step 1: Write the failing test**

`payment-gateway/packages/domain/tests/fees/compute.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/index.ts'
import { FeeInputError, computeFee } from '../../src/fees/compute.ts'
import { parseRulePack } from '../../src/fees/schema.ts'
import type { FeeInput } from '../../src/fees/types.ts'

/** A Telangana-shaped pack: proportional rates on the higher of two values. */
const telanganaPack = parseRulePack(
  {
    id: 'IN-TG',
    jurisdictionLabel: 'Telangana, India',
    currency: 'INR',
    version: '2026.1',
    timezone: 'Asia/Kolkata',
    provenance: 'SYNTHETIC',
    basisStrategy: 'MAX_OF_MARKET_AND_CONSIDERATION',
    requiredAttributes: [],
    components: [
      { code: 'STAMP_DUTY', label: 'Stamp duty', kind: 'PROPORTIONAL', ratePpm: 40000 },
      { code: 'TRANSFER_DUTY', label: 'Transfer duty', kind: 'PROPORTIONAL', ratePpm: 15000 },
      { code: 'REGISTRATION_FEE', label: 'Registration fee', kind: 'PROPORTIONAL', ratePpm: 5000 },
      { code: 'USER_CHARGES', label: 'User charges', kind: 'FLAT', amountMinor: '20000' },
    ],
  },
  'inline-test',
)

function input(overrides: Partial<FeeInput> = {}): FeeInput {
  return {
    jurisdictionId: 'IN-TG',
    propertyType: 'APARTMENT',
    transactionType: 'SALE',
    consideration: Money.of(480000000n, 'INR'),
    marketValue: Money.of(500000000n, 'INR'),
    attributes: {},
    ...overrides,
  }
}

describe('computeFee arithmetic', () => {
  const breakdown = computeFee(input(), telanganaPack)

  it('resolves the chargeable value by the pack strategy', () => {
    expect(breakdown.chargeableValue).toEqual({ amountMinor: '500000000', currency: 'INR' })
    expect(breakdown.basisStrategy).toBe('MAX_OF_MARKET_AND_CONSIDERATION')
  })

  it('computes each component', () => {
    const amounts = Object.fromEntries(
      breakdown.components.map((c) => [c.code, c.amount.amountMinor]),
    )
    expect(amounts).toEqual({
      STAMP_DUTY: '20000000',
      TRANSFER_DUTY: '7500000',
      REGISTRATION_FEE: '2500000',
      USER_CHARGES: '20000',
    })
  })

  it('sums the rounded components, never rounding the sum', () => {
    expect(breakdown.total).toEqual({ amountMinor: '30020000', currency: 'INR' })
  })

  it('preserves component order from the pack', () => {
    expect(breakdown.components.map((c) => c.code)).toEqual([
      'STAMP_DUTY',
      'TRANSFER_DUTY',
      'REGISTRATION_FEE',
      'USER_CHARGES',
    ])
  })
})

describe('FeeBreakdown provenance and shape', () => {
  const breakdown = computeFee(input(), telanganaPack)

  it('carries the pack identity so a historical fee is reproducible', () => {
    expect(breakdown.packId).toBe('IN-TG')
    expect(breakdown.packVersion).toBe('2026.1')
  })

  it('carries provenance and a synthetic disclaimer', () => {
    expect(breakdown.provenance).toBe('SYNTHETIC')
    expect(breakdown.disclaimer).toMatch(/illustrative/i)
    expect(breakdown.disclaimer).toMatch(/not.*(official|actual)/i)
  })

  it('is JSON-serialisable with no BigInt leaking out', () => {
    const json = JSON.stringify(breakdown)
    expect(json).toContain('"amountMinor":"30020000"')
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('reports every amount as a string, never a number', () => {
    for (const component of breakdown.components) {
      expect(typeof component.amount.amountMinor).toBe('string')
    }
    expect(typeof breakdown.total.amountMinor).toBe('string')
  })

  it('explains every component in appliedRules', () => {
    for (const component of breakdown.components) {
      expect(component.appliedRules.length).toBeGreaterThan(0)
    }
  })
})

describe('components that do not apply', () => {
  const reliefPack = parseRulePack(
    {
      id: 'GB-ENG',
      jurisdictionLabel: 'England',
      currency: 'GBP',
      version: '2026.1',
      timezone: 'Europe/London',
      provenance: 'SYNTHETIC',
      basisStrategy: 'CONSIDERATION_ONLY',
      requiredAttributes: [
        { name: 'firstTimeBuyer', kind: 'boolean', label: 'First-time buyer' },
      ],
      components: [
        { code: 'REGISTRY_FEE', label: 'Land registry fee', kind: 'FLAT', amountMinor: '65000' },
        {
          code: 'FTB_RELIEF',
          label: 'First-time buyer relief',
          kind: 'FLAT',
          amountMinor: '0',
          condition: {
            op: 'all',
            of: [
              { op: 'eq', attribute: 'firstTimeBuyer', value: true },
              { op: 'basisLte', amountMinor: '42500000' },
            ],
          },
        },
      ],
    },
    'inline-test',
  )

  const gbpInput = (firstTimeBuyer: boolean): FeeInput => ({
    jurisdictionId: 'GB-ENG',
    propertyType: 'HOUSE',
    transactionType: 'SALE',
    consideration: Money.of(39500000n, 'GBP'),
    marketValue: Money.of(39500000n, 'GBP'),
    attributes: { firstTimeBuyer },
  })

  it('still lists an excluded component, flagged not applied with a zero amount', () => {
    const breakdown = computeFee(gbpInput(false), reliefPack)
    const relief = breakdown.components.find((c) => c.code === 'FTB_RELIEF')
    expect(relief?.applied).toBe(false)
    expect(relief?.amount.amountMinor).toBe('0')
    expect(relief?.appliedRules.map((r) => r.code)).toContain('NOT_APPLIED')
  })

  it('excludes an unapplied component from the total', () => {
    expect(computeFee(gbpInput(false), reliefPack).total.amountMinor).toBe('65000')
    expect(computeFee(gbpInput(true), reliefPack).total.amountMinor).toBe('65000')
  })

  it('marks an applied component as applied', () => {
    const breakdown = computeFee(gbpInput(true), reliefPack)
    expect(breakdown.components.find((c) => c.code === 'FTB_RELIEF')?.applied).toBe(true)
  })
})

describe('input validation', () => {
  it('rejects a currency that disagrees with the pack', () => {
    expect(() =>
      computeFee(input({ consideration: Money.of(1n, 'GBP') }), telanganaPack),
    ).toThrow(FeeInputError)
  })

  it('names both currencies in the error', () => {
    expect(() => computeFee(input({ consideration: Money.of(1n, 'GBP') }), telanganaPack)).toThrow(
      /GBP.*INR|INR.*GBP/,
    )
  })

  it('rejects a jurisdiction id that disagrees with the pack', () => {
    expect(() => computeFee(input({ jurisdictionId: 'GB-ENG' }), telanganaPack)).toThrow(
      /GB-ENG/,
    )
  })

  it('rejects a negative consideration', () => {
    expect(() =>
      computeFee(input({ consideration: Money.of(-1n, 'INR') }), telanganaPack),
    ).toThrow(FeeInputError)
  })

  it('rejects a missing required attribute, naming it', () => {
    const packWithAttribute = parseRulePack(
      {
        id: 'SG',
        jurisdictionLabel: 'Singapore',
        currency: 'SGD',
        version: '2026.1',
        timezone: 'Asia/Singapore',
        provenance: 'SYNTHETIC',
        basisStrategy: 'CONSIDERATION_ONLY',
        requiredAttributes: [{ name: 'residency', kind: 'string', label: 'Residency', options: ['CITIZEN'] }],
        components: [{ code: 'DUTY', label: 'Duty', kind: 'PROPORTIONAL', ratePpm: 10000 }],
      },
      'inline-test',
    )
    expect(() =>
      computeFee(
        {
          jurisdictionId: 'SG',
          propertyType: 'APARTMENT',
          transactionType: 'SALE',
          consideration: Money.of(1n, 'SGD'),
          marketValue: Money.of(1n, 'SGD'),
          attributes: {},
        },
        packWithAttribute,
      ),
    ).toThrow(/residency/)
  })

  it('rejects an attribute of the wrong declared kind', () => {
    const packWithAttribute = parseRulePack(
      {
        id: 'SG',
        jurisdictionLabel: 'Singapore',
        currency: 'SGD',
        version: '2026.1',
        timezone: 'Asia/Singapore',
        provenance: 'SYNTHETIC',
        basisStrategy: 'CONSIDERATION_ONLY',
        requiredAttributes: [{ name: 'count', kind: 'number', label: 'Count' }],
        components: [{ code: 'DUTY', label: 'Duty', kind: 'PROPORTIONAL', ratePpm: 10000 }],
      },
      'inline-test',
    )
    expect(() =>
      computeFee(
        {
          jurisdictionId: 'SG',
          propertyType: 'APARTMENT',
          transactionType: 'SALE',
          consideration: Money.of(1n, 'SGD'),
          marketValue: Money.of(1n, 'SGD'),
          attributes: { count: 'two' },
        },
        packWithAttribute,
      ),
    ).toThrow(/count/)
  })

  it('rejects a string attribute outside its declared options', () => {
    const packWithOptions = parseRulePack(
      {
        id: 'US-CA',
        jurisdictionLabel: 'California',
        currency: 'USD',
        version: '2026.1',
        timezone: 'America/Los_Angeles',
        provenance: 'SYNTHETIC',
        basisStrategy: 'CONSIDERATION_ONLY',
        requiredAttributes: [
          { name: 'county', kind: 'string', label: 'County', options: ['Alameda', 'Los Angeles'] },
        ],
        components: [
          {
            code: 'TAX',
            label: 'Tax',
            kind: 'PROPORTIONAL',
            ratePpm: 1100,
            condition: { op: 'eq', attribute: 'county', value: 'Alameda' },
          },
        ],
      },
      'inline-test',
    )
    expect(() =>
      computeFee(
        {
          jurisdictionId: 'US-CA',
          propertyType: 'HOUSE',
          transactionType: 'SALE',
          consideration: Money.of(1n, 'USD'),
          marketValue: Money.of(1n, 'USD'),
          attributes: { county: 'Atlantis' },
        },
        packWithOptions,
      ),
    ).toThrow(/Atlantis/)
  })
})

describe('purity', () => {
  it('is deterministic — the same input yields an identical breakdown', () => {
    const first = computeFee(input(), telanganaPack)
    const second = computeFee(input(), telanganaPack)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('does not mutate its input', () => {
    const original = input()
    const snapshot = JSON.stringify({
      attributes: original.attributes,
      consideration: original.consideration.toString(),
    })
    computeFee(original, telanganaPack)
    expect(
      JSON.stringify({
        attributes: original.attributes,
        consideration: original.consideration.toString(),
      }),
    ).toBe(snapshot)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/compute.test.ts
```

Expected: FAIL — cannot resolve `../../src/fees/compute.ts`.

- [ ] **Step 3: Write the implementation**

`payment-gateway/packages/domain/src/fees/compute.ts`:

```typescript
import { Money, toWire } from '../money/index.ts'
import { resolveChargeableValue } from './basis.ts'
import { computeComponent } from './components.ts'
import { describeCondition } from './condition.ts'
import type {
  ComputedComponent,
  FeeBreakdown,
  FeeInput,
  JurisdictionRulePack,
} from './types.ts'

export const SYNTHETIC_DISCLAIMER =
  'Illustrative rates for demonstration only — not this jurisdiction’s actual ' +
  'fees, and not an official assessment.'

export const SOURCED_DISCLAIMER =
  'Computed from published rates. Demonstration computation, not an official assessment.'

export class FeeInputError extends Error {
  constructor(detail: string) {
    super(`Invalid fee input: ${detail}`)
    this.name = 'FeeInputError'
  }
}

/**
 * Check an input against a pack before computing.
 *
 * Exported so the HTTP layer can reject a bad request with a 400 before
 * any computation happens; computeFee calls it too, so the engine is never
 * reachable with an invalid input.
 */
export function validateFeeInput(input: FeeInput, pack: JurisdictionRulePack): void {
  if (input.jurisdictionId !== pack.id) {
    throw new FeeInputError(
      `input names jurisdiction "${input.jurisdictionId}" but the pack is "${pack.id}"`,
    )
  }
  if (input.consideration.currency !== pack.currency) {
    throw new FeeInputError(
      `consideration is in ${input.consideration.currency} but pack ${pack.id} charges in ${pack.currency}`,
    )
  }
  if (input.marketValue.currency !== pack.currency) {
    throw new FeeInputError(
      `marketValue is in ${input.marketValue.currency} but pack ${pack.id} charges in ${pack.currency}`,
    )
  }
  if (input.consideration.isNegative()) {
    throw new FeeInputError('consideration must not be negative')
  }
  if (input.marketValue.isNegative()) {
    throw new FeeInputError('marketValue must not be negative')
  }

  // Validation is driven entirely by the pack's declaration, so adding a
  // jurisdiction needs no engine change (FR-2).
  for (const attribute of pack.requiredAttributes) {
    if (!Object.hasOwn(input.attributes, attribute.name)) {
      throw new FeeInputError(
        `pack ${pack.id} requires attribute "${attribute.name}" (${attribute.label}), which is missing`,
      )
    }
    const value = input.attributes[attribute.name]
    if (typeof value !== attribute.kind) {
      throw new FeeInputError(
        `attribute "${attribute.name}" must be a ${attribute.kind}, received ${typeof value}`,
      )
    }
    if (attribute.options !== null && typeof value === 'string' && !attribute.options.includes(value)) {
      throw new FeeInputError(
        `attribute "${attribute.name}" value "${value}" is not one of: ${attribute.options.join(', ')}`,
      )
    }
  }
}

/**
 * Compute a fully self-explaining fee breakdown (FR-1, FR-5).
 *
 * Pure: no I/O, no clock, no randomness, and no branching on a
 * jurisdiction id. Everything jurisdiction-specific comes from the pack.
 */
export function computeFee(input: FeeInput, pack: JurisdictionRulePack): FeeBreakdown {
  validateFeeInput(input, pack)

  const chargeableValue = resolveChargeableValue(input, pack.basisStrategy)
  const ctx = { chargeableValue, attributes: input.attributes }

  const components: ComputedComponent[] = []
  const applicableAmounts: Money[] = []

  for (const rule of pack.components) {
    const computed = computeComponent(rule, ctx)

    if (computed === null) {
      // Listed but not applied, so a citizen can see the rule exists and
      // why it did not fire. Zero-amount, but distinct from "applied and
      // worth nothing".
      components.push({
        code: rule.code,
        label: rule.label,
        kind: rule.kind,
        applied: false,
        basis: null,
        ratePpm: null,
        bands: null,
        amount: { amountMinor: '0', currency: pack.currency },
        appliedRules: [
          {
            code: 'NOT_APPLIED',
            detail: `not applied: condition requires ${describeCondition(rule.condition)}`,
          },
        ],
      })
      continue
    }

    components.push({
      code: rule.code,
      label: rule.label,
      kind: rule.kind,
      applied: true,
      basis: computed.basis === null ? null : toWire(computed.basis),
      ratePpm: computed.ratePpm,
      bands: computed.bands,
      amount: toWire(computed.amount),
      appliedRules: computed.appliedRules,
    })
    applicableAmounts.push(computed.amount)
  }

  // Components are rounded individually then summed; never summed then
  // rounded (FR-7).
  const total = Money.sum(applicableAmounts, pack.currency)

  return {
    jurisdictionId: pack.id,
    currency: pack.currency,
    chargeableValue: toWire(chargeableValue),
    basisStrategy: pack.basisStrategy,
    components,
    total: toWire(total),
    packId: pack.id,
    packVersion: pack.version,
    provenance: pack.provenance,
    packSource: pack.packSource,
    packRetrievedAt: pack.packRetrievedAt,
    disclaimer: pack.provenance === 'SYNTHETIC' ? SYNTHETIC_DISCLAIMER : SOURCED_DISCLAIMER,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/compute.test.ts
```

Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add payment-gateway/packages/domain/src/fees/compute.ts payment-gateway/packages/domain/tests/fees/compute.test.ts
git commit -m "feat: add computeFee, the pure jurisdiction-neutral fee engine"
```

---

## Task 11: Pack loader and the no-jurisdiction-branch guard

The loader is the one file in `packages/domain` permitted to touch the filesystem, and it does so only synchronously at startup. Keeping it in a single module is what lets every other domain file stay pure.

**Files:**
- Create: `payment-gateway/packages/domain/src/fees/loader.ts`
- Create: `payment-gateway/packages/domain/src/fees/index.ts`
- Create: `payment-gateway/packages/domain/tests/fees/loader.test.ts`
- Create: `payment-gateway/packages/domain/tests/guards/no-jurisdiction-branch.test.ts`
- Modify: `payment-gateway/packages/domain/src/index.ts` (add `export * from './fees/index.ts'`)

**Interfaces:**
- Consumes: `parseRulePack`, `InvalidRulePackError`, `JurisdictionRulePack`.
- Produces:
  - `class PackRegistryError extends Error`
  - `interface PackRegistry { get(id: string): JurisdictionRulePack; has(id: string): boolean; ids(): readonly string[]; all(): readonly JurisdictionRulePack[] }`
  - `function loadPackFromFile(absolutePath: string): JurisdictionRulePack`
  - `function loadPackRegistry(directory: string): PackRegistry`
  - `const DEFAULT_JURISDICTIONS_DIR: string` — resolved from the package location to `config/jurisdictions`

The loader throws on the first invalid pack rather than collecting errors. FR-10 and GW-4 both call for failing the boot, and a service that starts with five of six packs is worse than one that refuses to start: the missing jurisdiction becomes a 404 for a citizen instead of a deployment failure for an operator.

- [ ] **Step 1: Write the failing loader test**

`payment-gateway/packages/domain/tests/fees/loader.test.ts`:

```typescript
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidRulePackError } from '../../src/fees/schema.ts'
import { PackRegistryError, loadPackRegistry } from '../../src/fees/loader.ts'

let directory: string

const validPack = (id: string, currency = 'GBP') => ({
  id,
  jurisdictionLabel: `Label ${id}`,
  currency,
  version: '2026.1',
  timezone: 'Europe/London',
  provenance: 'SYNTHETIC',
  basisStrategy: 'CONSIDERATION_ONLY',
  requiredAttributes: [],
  components: [{ code: 'FEE', label: 'Fee', kind: 'FLAT', amountMinor: '1' }],
})

function write(filename: string, contents: unknown): void {
  writeFileSync(
    join(directory, filename),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
    'utf8',
  )
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'packs-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('loadPackRegistry', () => {
  it('loads every JSON pack in the directory', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    write('JP-2026.1.json', validPack('JP', 'JPY'))

    const registry = loadPackRegistry(directory)
    expect([...registry.ids()].sort()).toEqual(['GB-ENG', 'JP'])
    expect(registry.get('JP').currency).toBe('JPY')
    expect(registry.has('GB-ENG')).toBe(true)
    expect(registry.has('AE-DU')).toBe(false)
  })

  it('returns packs sorted by id, so listings are stable', () => {
    write('JP-2026.1.json', validPack('JP', 'JPY'))
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    expect(loadPackRegistry(directory).all().map((p) => p.id)).toEqual(['GB-ENG', 'JP'])
  })

  it('ignores non-JSON files', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    write('README.md', '# not a pack')
    expect(loadPackRegistry(directory).ids()).toHaveLength(1)
  })

  it('FAILS THE BOOT on an invalid pack rather than skipping it', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    write('BAD-2026.1.json', { id: 'BAD' })
    expect(() => loadPackRegistry(directory)).toThrow(InvalidRulePackError)
  })

  it('fails the boot on an unmarked provenance', () => {
    const { provenance: _omitted, ...unmarked } = validPack('GB-ENG')
    write('GB-ENG-2026.1.json', unmarked)
    expect(() => loadPackRegistry(directory)).toThrow(InvalidRulePackError)
  })

  it('names the offending file in the error', () => {
    write('BAD-2026.1.json', { id: 'BAD' })
    expect(() => loadPackRegistry(directory)).toThrow(/BAD-2026\.1\.json/)
  })

  it('fails on malformed JSON, naming the file', () => {
    write('BROKEN-2026.1.json', '{ not json')
    expect(() => loadPackRegistry(directory)).toThrow(/BROKEN-2026\.1\.json/)
  })

  it('rejects two packs claiming the same id', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    write('GB-ENG-2026.2.json', { ...validPack('GB-ENG'), version: '2026.2' })
    expect(() => loadPackRegistry(directory)).toThrow(PackRegistryError)
    expect(() => loadPackRegistry(directory)).toThrow(/GB-ENG/)
  })

  it('rejects an empty directory, because a service with no jurisdictions is useless', () => {
    expect(() => loadPackRegistry(directory)).toThrow(PackRegistryError)
  })

  it('rejects a missing directory', () => {
    expect(() => loadPackRegistry(join(directory, 'nope'))).toThrow(PackRegistryError)
  })

  it('throws a legible error for an unknown id at get time', () => {
    write('GB-ENG-2026.1.json', validPack('GB-ENG'))
    const registry = loadPackRegistry(directory)
    expect(() => registry.get('XX')).toThrow(PackRegistryError)
    expect(() => registry.get('XX')).toThrow(/GB-ENG/) // lists what IS available
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/loader.test.ts
```

Expected: FAIL — cannot resolve `../../src/fees/loader.ts`.

- [ ] **Step 3: Write the loader**

`payment-gateway/packages/domain/src/fees/loader.ts`:

```typescript
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRulePack } from './schema.ts'
import type { JurisdictionRulePack } from './types.ts'

/**
 * The default pack directory, resolved relative to this package rather
 * than to process.cwd(), so a server started from any directory finds it.
 * packages/domain/src/fees -> ../../../../config/jurisdictions
 */
export const DEFAULT_JURISDICTIONS_DIR = fileURLToPath(
  new URL('../../../../config/jurisdictions', import.meta.url),
)

export class PackRegistryError extends Error {
  constructor(detail: string) {
    super(`Jurisdiction pack registry: ${detail}`)
    this.name = 'PackRegistryError'
  }
}

export interface PackRegistry {
  get(id: string): JurisdictionRulePack
  has(id: string): boolean
  ids(): readonly string[]
  all(): readonly JurisdictionRulePack[]
}

export function loadPackFromFile(absolutePath: string): JurisdictionRulePack {
  const label = basename(absolutePath)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(absolutePath, 'utf8'))
  } catch (cause) {
    throw new PackRegistryError(
      `could not read or parse "${label}": ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  // parseRulePack throws InvalidRulePackError, which already names the file.
  return parseRulePack(raw, label)
}

/**
 * Load every pack in a directory, or throw.
 *
 * Throws on the FIRST problem rather than collecting them. FR-10 and GW-4
 * both require failing the boot: a service that starts with a missing
 * jurisdiction turns an operator's deployment failure into a citizen's 404.
 */
export function loadPackRegistry(directory: string): PackRegistry {
  let entries: string[]
  try {
    if (!statSync(directory).isDirectory()) {
      throw new PackRegistryError(`"${directory}" is not a directory`)
    }
    entries = readdirSync(directory)
  } catch (cause) {
    if (cause instanceof PackRegistryError) throw cause
    throw new PackRegistryError(
      `could not read directory "${directory}": ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  const byId = new Map<string, JurisdictionRulePack>()
  const sourceById = new Map<string, string>()

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue
    const pack = loadPackFromFile(join(directory, entry))
    const existing = sourceById.get(pack.id)
    if (existing !== undefined) {
      throw new PackRegistryError(
        `two packs claim id "${pack.id}": "${existing}" and "${entry}". ` +
          'Exactly one version of a jurisdiction may be loaded at a time.',
      )
    }
    byId.set(pack.id, pack)
    sourceById.set(pack.id, entry)
  }

  if (byId.size === 0) {
    throw new PackRegistryError(
      `no jurisdiction packs found in "${directory}". The service cannot start without at least one.`,
    )
  }

  const sortedIds = [...byId.keys()].sort()
  const sortedPacks = sortedIds.map((id) => byId.get(id) as JurisdictionRulePack)

  return {
    get(id: string): JurisdictionRulePack {
      const pack = byId.get(id)
      if (pack === undefined) {
        throw new PackRegistryError(
          `unknown jurisdiction "${id}". Loaded jurisdictions: ${sortedIds.join(', ')}`,
        )
      }
      return pack
    },
    has: (id: string) => byId.has(id),
    ids: () => sortedIds,
    all: () => sortedPacks,
  }
}
```

- [ ] **Step 4: Write the fees module barrel**

`payment-gateway/packages/domain/src/fees/index.ts`:

```typescript
export type {
  AppliedRule,
  AttributeValue,
  Band,
  BasisStrategy,
  ComputedBand,
  ComputedComponent,
  Condition,
  FeeBreakdown,
  FeeComponentRule,
  FeeInput,
  FlatRule,
  JurisdictionRulePack,
  ProgressiveBandsRule,
  ProportionalRule,
  Provenance,
  PropertyType,
  RequiredAttribute,
  TransactionType,
} from './types.ts'

export { InvalidRulePackError, JurisdictionRulePackSchema, parseRulePack } from './schema.ts'

export {
  AttributeTypeError,
  MissingAttributeError,
  describeCondition,
  evaluateCondition,
} from './condition.ts'
export type { ConditionContext } from './condition.ts'

export { resolveChargeableValue } from './basis.ts'

export { computeComponent } from './components.ts'
export type { ComponentComputation, ComponentContext } from './components.ts'

export {
  FeeInputError,
  SOURCED_DISCLAIMER,
  SYNTHETIC_DISCLAIMER,
  computeFee,
  validateFeeInput,
} from './compute.ts'

export {
  DEFAULT_JURISDICTIONS_DIR,
  PackRegistryError,
  loadPackFromFile,
  loadPackRegistry,
} from './loader.ts'
export type { PackRegistry } from './loader.ts'
```

- [ ] **Step 5: Update the package entry**

`payment-gateway/packages/domain/src/index.ts`:

```typescript
export const PACKAGE_NAME = '@registry/domain'

export * from './money/index.ts'
export * from './fees/index.ts'
```

- [ ] **Step 6: Write the no-jurisdiction-branch guard**

`payment-gateway/packages/domain/tests/guards/no-jurisdiction-branch.test.ts`:

```typescript
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
```

The guard strips comments first, which is what lets `basis.ts` explain *why* India and England differ in prose without tripping it. That is the correct distinction: documenting a jurisdictional difference is good, branching on one is not.

- [ ] **Step 7: Run the full suite**

```bash
cd payment-gateway/packages/domain && npx vitest run
```

Expected: PASS — all suites. If the jurisdiction guard fails, the fix is always to move the jurisdictional fact into a pack file, never to relax the guard.

- [ ] **Step 8: Commit**

```bash
git add payment-gateway/packages/domain/src/fees payment-gateway/packages/domain/src/index.ts payment-gateway/packages/domain/tests
git commit -m "feat: add pack registry loader that fails the boot on any invalid pack"
```

---

## Task 12: Golden fixture harness, and the first two packs

The harness comes before the remaining packs so that every later pack is gated by it automatically. It discovers packs by globbing the directory, so a pack added without fixtures **fails CI** — that is the mechanism enforcing FR-9.

**Files:**
- Create: `payment-gateway/packages/domain/tests/fees/packs.golden.test.ts`
- Create: `config/jurisdictions/IN-TG-2026.1.json`
- Create: `config/fixtures/IN-TG.golden.json`
- Create: `config/jurisdictions/GB-ENG-2026.1.json`
- Create: `config/fixtures/GB-ENG.golden.json`

**Interfaces:**
- Consumes: `loadPackRegistry`, `computeFee`, `Money`, `DEFAULT_JURISDICTIONS_DIR`.
- Produces: the fixture file format, which every later pack task follows:

```typescript
interface GoldenFixtureFile {
  readonly packId: string
  readonly cases: readonly {
    readonly name: string
    readonly input: {
      readonly propertyType: string
      readonly transactionType: string
      readonly considerationMinor: string
      readonly marketValueMinor: string
      readonly attributes: Record<string, string | number | boolean>
    }
    readonly expected: {
      readonly chargeableValueMinor: string
      readonly components: Record<string, string>  // code -> amountMinor
      readonly notApplied: readonly string[]
      readonly totalMinor: string
    }
  }[]
}
```

**All rates below are synthetic** (FR-10, and the organisation rule against presenting invented figures as real). Each pack carries `"provenance": "SYNTHETIC"`, which forces the banner in the UI, the API response, and the receipt.

- [ ] **Step 1: Write the golden harness**

`payment-gateway/packages/domain/tests/fees/packs.golden.test.ts`:

```typescript
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Money } from '../../src/money/index.ts'
import { computeFee } from '../../src/fees/compute.ts'
import { loadPackRegistry } from '../../src/fees/loader.ts'
import type { AttributeValue, PropertyType, TransactionType } from '../../src/fees/types.ts'

const configRoot = fileURLToPath(new URL('../../../../config/', import.meta.url))
const jurisdictionsDir = join(configRoot, 'jurisdictions')
const fixturesDir = join(configRoot, 'fixtures')

interface GoldenCase {
  readonly name: string
  readonly input: {
    readonly propertyType: PropertyType
    readonly transactionType: TransactionType
    readonly considerationMinor: string
    readonly marketValueMinor: string
    readonly attributes: Record<string, AttributeValue>
  }
  readonly expected: {
    readonly chargeableValueMinor: string
    readonly components: Record<string, string>
    readonly notApplied: readonly string[]
    readonly totalMinor: string
  }
}

interface GoldenFixtureFile {
  readonly packId: string
  readonly cases: readonly GoldenCase[]
}

const registry = loadPackRegistry(jurisdictionsDir)

describe('every jurisdiction pack', () => {
  it('loads at least one pack, so a broken path cannot pass vacuously', () => {
    expect(registry.ids().length).toBeGreaterThan(0)
  })

  it('has a fixture file for EVERY pack — a pack without fixtures fails CI (FR-9)', () => {
    const missing = registry
      .ids()
      .filter((id) => !existsSync(join(fixturesDir, `${id}.golden.json`)))
    expect(missing).toEqual([])
  })

  it('has no orphaned fixture for a pack that no longer exists', () => {
    const orphans = readdirSync(fixturesDir)
      .filter((name) => name.endsWith('.golden.json'))
      .map((name) => name.replace('.golden.json', ''))
      .filter((id) => !registry.has(id))
    expect(orphans).toEqual([])
  })

  it('is marked SYNTHETIC, because this POC ships no authoritative rates (FR-10)', () => {
    const notSynthetic = registry
      .all()
      .filter((pack) => pack.provenance !== 'SYNTHETIC')
      .map((pack) => pack.id)
    expect(notSynthetic).toEqual([])
  })
})

for (const pack of registry.all()) {
  describe(`pack ${pack.id} (${pack.jurisdictionLabel})`, () => {
    const fixturePath = join(fixturesDir, `${pack.id}.golden.json`)
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenFixtureFile

    it('has a fixture file naming this pack', () => {
      expect(fixture.packId).toBe(pack.id)
    })

    it('declares at least one case', () => {
      expect(fixture.cases.length).toBeGreaterThan(0)
    })

    for (const testCase of fixture.cases) {
      describe(testCase.name, () => {
        const breakdown = computeFee(
          {
            jurisdictionId: pack.id,
            propertyType: testCase.input.propertyType,
            transactionType: testCase.input.transactionType,
            consideration: Money.of(BigInt(testCase.input.considerationMinor), pack.currency),
            marketValue: Money.of(BigInt(testCase.input.marketValueMinor), pack.currency),
            attributes: testCase.input.attributes,
          },
          pack,
        )

        it('resolves the expected chargeable value', () => {
          expect(breakdown.chargeableValue.amountMinor).toBe(
            testCase.expected.chargeableValueMinor,
          )
        })

        it('computes every applied component to the expected amount', () => {
          const actual = Object.fromEntries(
            breakdown.components
              .filter((component) => component.applied)
              .map((component) => [component.code, component.amount.amountMinor]),
          )
          expect(actual).toEqual(testCase.expected.components)
        })

        it('applies exactly the components the fixture expects to be skipped', () => {
          const actual = breakdown.components
            .filter((component) => !component.applied)
            .map((component) => component.code)
            .sort()
          expect(actual).toEqual([...testCase.expected.notApplied].sort())
        })

        it('totals to the expected amount', () => {
          expect(breakdown.total.amountMinor).toBe(testCase.expected.totalMinor)
        })

        it('totals exactly the sum of its applied components', () => {
          const summed = breakdown.components
            .filter((component) => component.applied)
            .reduce((accumulator, component) => accumulator + BigInt(component.amount.amountMinor), 0n)
          expect(breakdown.total.amountMinor).toBe(summed.toString())
        })

        it('carries the synthetic disclaimer on the breakdown', () => {
          expect(breakdown.provenance).toBe('SYNTHETIC')
          expect(breakdown.disclaimer).toMatch(/illustrative/i)
        })

        it('reports the pack version, so this fee is reproducible later', () => {
          expect(breakdown.packVersion).toBe(pack.version)
        })
      })
    }
  })
}
```

The `notApplied` assertion is what makes a fixture a real regression test rather than a total check: it pins *which* rules fired, so a condition that silently starts matching everything is caught even when the total happens to be unchanged.

- [ ] **Step 2: Run the harness to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/packs.golden.test.ts
```

Expected: FAIL — `PackRegistryError: no jurisdiction packs found`. The directory does not exist yet.

- [ ] **Step 3: Write the Telangana pack**

`config/jurisdictions/IN-TG-2026.1.json`:

```json
{
  "id": "IN-TG",
  "jurisdictionLabel": "Telangana, India (synthetic)",
  "currency": "INR",
  "version": "2026.1",
  "timezone": "Asia/Kolkata",
  "provenance": "SYNTHETIC",
  "packSource": null,
  "packRetrievedAt": null,
  "basisStrategy": "MAX_OF_MARKET_AND_CONSIDERATION",
  "requiredAttributes": [],
  "components": [
    {
      "code": "STAMP_DUTY",
      "label": "Stamp duty",
      "kind": "PROPORTIONAL",
      "ratePpm": 40000,
      "rounding": "HALF_UP"
    },
    {
      "code": "TRANSFER_DUTY",
      "label": "Transfer duty",
      "kind": "PROPORTIONAL",
      "ratePpm": 15000,
      "rounding": "HALF_UP"
    },
    {
      "code": "REGISTRATION_FEE",
      "label": "Registration fee",
      "kind": "PROPORTIONAL",
      "ratePpm": 5000,
      "rounding": "HALF_UP"
    },
    {
      "code": "USER_CHARGES",
      "label": "User charges",
      "kind": "FLAT",
      "amountMinor": "20000"
    }
  ]
}
```

`config/fixtures/IN-TG.golden.json`:

```json
{
  "packId": "IN-TG",
  "cases": [
    {
      "name": "apartment sale, market value above consideration",
      "input": {
        "propertyType": "APARTMENT",
        "transactionType": "SALE",
        "considerationMinor": "480000000",
        "marketValueMinor": "500000000",
        "attributes": {}
      },
      "expected": {
        "chargeableValueMinor": "500000000",
        "components": {
          "STAMP_DUTY": "20000000",
          "TRANSFER_DUTY": "7500000",
          "REGISTRATION_FEE": "2500000",
          "USER_CHARGES": "20000"
        },
        "notApplied": [],
        "totalMinor": "30020000"
      }
    },
    {
      "name": "consideration above market value, so consideration is charged",
      "input": {
        "propertyType": "HOUSE",
        "transactionType": "SALE",
        "considerationMinor": "600000000",
        "marketValueMinor": "500000000",
        "attributes": {}
      },
      "expected": {
        "chargeableValueMinor": "600000000",
        "components": {
          "STAMP_DUTY": "24000000",
          "TRANSFER_DUTY": "9000000",
          "REGISTRATION_FEE": "3000000",
          "USER_CHARGES": "20000"
        },
        "notApplied": [],
        "totalMinor": "36020000"
      }
    },
    {
      "name": "a value that forces rounding on every proportional component",
      "input": {
        "propertyType": "LAND",
        "transactionType": "SALE",
        "considerationMinor": "1234567",
        "marketValueMinor": "1234567",
        "attributes": {}
      },
      "expected": {
        "chargeableValueMinor": "1234567",
        "components": {
          "STAMP_DUTY": "49383",
          "TRANSFER_DUTY": "18519",
          "REGISTRATION_FEE": "6173",
          "USER_CHARGES": "20000"
        },
        "notApplied": [],
        "totalMinor": "94075"
      }
    }
  ]
}
```

The third case is the one that proves FR-7. `1234567 × 40000 / 1000000 = 49382.68`, `× 15000 = 18518.505`, `× 5000 = 6172.835`. Rounded individually HALF_UP: `49383 + 18519 + 6173 + 20000 = 94075`. Summing the unrounded values first and rounding once would give `94074`. The fixture pins the correct answer.

- [ ] **Step 4: Write the England pack**

England needs mutually exclusive band schedules rather than a negative relief component: minor amounts are unsigned by schema, and a relief modelled as "a different schedule applies" is closer to how the statute actually reads.

`config/jurisdictions/GB-ENG-2026.1.json`:

```json
{
  "id": "GB-ENG",
  "jurisdictionLabel": "England, United Kingdom (synthetic)",
  "currency": "GBP",
  "version": "2026.1",
  "timezone": "Europe/London",
  "provenance": "SYNTHETIC",
  "packSource": null,
  "packRetrievedAt": null,
  "basisStrategy": "CONSIDERATION_ONLY",
  "requiredAttributes": [
    {
      "name": "firstTimeBuyer",
      "kind": "boolean",
      "label": "Is this your first property purchase?",
      "options": null
    }
  ],
  "components": [
    {
      "code": "TRANSFER_DUTY_STANDARD",
      "label": "Transfer duty",
      "kind": "PROGRESSIVE_BANDS",
      "rounding": "HALF_UP",
      "condition": {
        "op": "not",
        "of": {
          "op": "all",
          "of": [
            { "op": "eq", "attribute": "firstTimeBuyer", "value": true },
            { "op": "basisLte", "amountMinor": "42500000" }
          ]
        }
      },
      "bands": [
        { "upToMinor": "15000000", "ratePpm": 0 },
        { "upToMinor": "30000000", "ratePpm": 20000 },
        { "upToMinor": null, "ratePpm": 30000 }
      ]
    },
    {
      "code": "TRANSFER_DUTY_FIRST_TIME_BUYER",
      "label": "Transfer duty — first-time buyer relief",
      "kind": "PROGRESSIVE_BANDS",
      "rounding": "HALF_UP",
      "condition": {
        "op": "all",
        "of": [
          { "op": "eq", "attribute": "firstTimeBuyer", "value": true },
          { "op": "basisLte", "amountMinor": "42500000" }
        ]
      },
      "bands": [
        { "upToMinor": "42500000", "ratePpm": 0 },
        { "upToMinor": null, "ratePpm": 50000 }
      ]
    },
    {
      "code": "LAND_REGISTRY_FEE",
      "label": "Land registry fee",
      "kind": "FLAT",
      "amountMinor": "65000"
    }
  ]
}
```

`config/fixtures/GB-ENG.golden.json`:

```json
{
  "packId": "GB-ENG",
  "cases": [
    {
      "name": "not a first-time buyer, duty charged in marginal bands",
      "input": {
        "propertyType": "HOUSE",
        "transactionType": "SALE",
        "considerationMinor": "39500000",
        "marketValueMinor": "39500000",
        "attributes": { "firstTimeBuyer": false }
      },
      "expected": {
        "chargeableValueMinor": "39500000",
        "components": {
          "TRANSFER_DUTY_STANDARD": "585000",
          "LAND_REGISTRY_FEE": "65000"
        },
        "notApplied": ["TRANSFER_DUTY_FIRST_TIME_BUYER"],
        "totalMinor": "650000"
      }
    },
    {
      "name": "first-time buyer below the threshold pays no duty",
      "input": {
        "propertyType": "APARTMENT",
        "transactionType": "SALE",
        "considerationMinor": "39500000",
        "marketValueMinor": "39500000",
        "attributes": { "firstTimeBuyer": true }
      },
      "expected": {
        "chargeableValueMinor": "39500000",
        "components": {
          "TRANSFER_DUTY_FIRST_TIME_BUYER": "0",
          "LAND_REGISTRY_FEE": "65000"
        },
        "notApplied": ["TRANSFER_DUTY_STANDARD"],
        "totalMinor": "65000"
      }
    },
    {
      "name": "first-time buyer ABOVE the threshold loses relief entirely",
      "input": {
        "propertyType": "HOUSE",
        "transactionType": "SALE",
        "considerationMinor": "42500001",
        "marketValueMinor": "42500001",
        "attributes": { "firstTimeBuyer": true }
      },
      "expected": {
        "chargeableValueMinor": "42500001",
        "components": {
          "TRANSFER_DUTY_STANDARD": "675000",
          "LAND_REGISTRY_FEE": "65000"
        },
        "notApplied": ["TRANSFER_DUTY_FIRST_TIME_BUYER"],
        "totalMinor": "740000"
      }
    },
    {
      "name": "exactly at the zero-rate bound, no duty",
      "input": {
        "propertyType": "HOUSE",
        "transactionType": "SALE",
        "considerationMinor": "15000000",
        "marketValueMinor": "15000000",
        "attributes": { "firstTimeBuyer": false }
      },
      "expected": {
        "chargeableValueMinor": "15000000",
        "components": {
          "TRANSFER_DUTY_STANDARD": "0",
          "LAND_REGISTRY_FEE": "65000"
        },
        "notApplied": ["TRANSFER_DUTY_FIRST_TIME_BUYER"],
        "totalMinor": "65000"
      }
    }
  ]
}
```

Case three is worth reading twice: one penny above the relief threshold, relief vanishes and standard duty applies to the whole value. `150,000 @ 2% = 3,000.00` plus `125,000.01 @ 3% = 3,750.0003` rounding HALF_UP to `3,750.00`, giving `675000` minor. That cliff edge is real behaviour in banded relief schemes and exactly the kind of boundary a hand-written test would miss.

- [ ] **Step 5: Run the harness to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/packs.golden.test.ts
```

Expected: PASS — 2 packs, 7 cases.

- [ ] **Step 6: Prove the harness rejects a pack with no fixtures**

Create `config/jurisdictions/ZZ-2026.1.json` as a copy of the Telangana pack with `"id": "ZZ"`, then run the harness:

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/packs.golden.test.ts
```

Expected: FAIL on `has a fixture file for EVERY pack`, listing `ZZ`. **Delete the file** and re-run to confirm PASS. Do not commit it.

- [ ] **Step 7: Commit**

```bash
git add config payment-gateway/packages/domain/tests/fees/packs.golden.test.ts
git commit -m "feat: add Telangana and England rule packs with a globbing golden harness"
```

---

## Task 13: The remaining four packs

Four packs, one commit each, no engine changes. If any of these needs a TypeScript change, **stop** — the abstraction is wrong, and the spec says so explicitly (M6b). All rates synthetic.

**Files:**
- Create: `config/jurisdictions/JP-2026.1.json`, `config/fixtures/JP.golden.json`
- Create: `config/jurisdictions/AE-DU-2026.1.json`, `config/fixtures/AE-DU.golden.json`
- Create: `config/jurisdictions/US-CA-2026.1.json`, `config/fixtures/US-CA.golden.json`
- Create: `config/jurisdictions/SG-2026.1.json`, `config/fixtures/SG.golden.json`

**Interfaces:**
- Consumes: the pack schema from Task 7 and the fixture format from Task 12. No new code.
- Produces: nothing importable. Six loadable jurisdictions.

- [ ] **Step 1: Write the Japan pack — the zero-decimal currency**

`config/jurisdictions/JP-2026.1.json`:

```json
{
  "id": "JP",
  "jurisdictionLabel": "Japan (synthetic)",
  "currency": "JPY",
  "version": "2026.1",
  "timezone": "Asia/Tokyo",
  "provenance": "SYNTHETIC",
  "packSource": null,
  "packRetrievedAt": null,
  "basisStrategy": "CONSIDERATION_ONLY",
  "requiredAttributes": [],
  "components": [
    {
      "code": "REGISTRATION_LICENCE_TAX",
      "label": "Registration and licence tax",
      "kind": "PROPORTIONAL",
      "ratePpm": 20000,
      "rounding": "FLOOR"
    },
    {
      "code": "JUDICIAL_SCRIVENER_FEE",
      "label": "Judicial scrivener fee",
      "kind": "FLAT",
      "amountMinor": "50000"
    }
  ]
}
```

`config/fixtures/JP.golden.json`:

```json
{
  "packId": "JP",
  "cases": [
    {
      "name": "apartment sale, whole yen amounts throughout",
      "input": {
        "propertyType": "APARTMENT",
        "transactionType": "SALE",
        "considerationMinor": "60000000",
        "marketValueMinor": "60000000",
        "attributes": {}
      },
      "expected": {
        "chargeableValueMinor": "60000000",
        "components": {
          "REGISTRATION_LICENCE_TAX": "1200000",
          "JUDICIAL_SCRIVENER_FEE": "50000"
        },
        "notApplied": [],
        "totalMinor": "1250000"
      }
    },
    {
      "name": "a value whose tax is fractional in yen, floored to whole yen",
      "input": {
        "propertyType": "HOUSE",
        "transactionType": "SALE",
        "considerationMinor": "12345679",
        "marketValueMinor": "12345679",
        "attributes": {}
      },
      "expected": {
        "chargeableValueMinor": "12345679",
        "components": {
          "REGISTRATION_LICENCE_TAX": "246913",
          "JUDICIAL_SCRIVENER_FEE": "50000"
        },
        "notApplied": [],
        "totalMinor": "296913"
      }
    }
  ]
}
```

The second case matters because in a zero-exponent currency the *minor* unit is the whole yen: `12345679 × 20000 / 1000000 = 246913.58`, floored to `246913`. There is no sub-yen amount to round into, so a system that assumed two decimals would produce `¥246,913.58` — a currency amount that cannot exist.

- [ ] **Step 2: Run the harness**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/packs.golden.test.ts
```

Expected: PASS — 3 packs.

- [ ] **Step 3: Commit Japan**

```bash
git add config/jurisdictions/JP-2026.1.json config/fixtures/JP.golden.json
git commit -m "feat: add Japan rule pack, exercising a zero-decimal currency"
```

- [ ] **Step 4: Write the Dubai pack — flat percentage on consideration only**

`config/jurisdictions/AE-DU-2026.1.json`:

```json
{
  "id": "AE-DU",
  "jurisdictionLabel": "Dubai, United Arab Emirates (synthetic)",
  "currency": "AED",
  "version": "2026.1",
  "timezone": "Asia/Dubai",
  "provenance": "SYNTHETIC",
  "packSource": null,
  "packRetrievedAt": null,
  "basisStrategy": "CONSIDERATION_ONLY",
  "requiredAttributes": [
    {
      "name": "mortgaged",
      "kind": "boolean",
      "label": "Is this purchase financed by a mortgage?",
      "options": null
    },
    {
      "name": "loanAmountMinor",
      "kind": "number",
      "label": "Loan amount (minor units)",
      "options": null
    }
  ],
  "components": [
    {
      "code": "TRANSFER_FEE",
      "label": "Transfer fee",
      "kind": "PROPORTIONAL",
      "ratePpm": 40000,
      "rounding": "HALF_UP"
    },
    {
      "code": "MORTGAGE_REGISTRATION",
      "label": "Mortgage registration",
      "kind": "PROPORTIONAL",
      "ratePpm": 2500,
      "basisAttribute": "loanAmountMinor",
      "rounding": "HALF_UP",
      "condition": { "op": "eq", "attribute": "mortgaged", "value": true }
    },
    {
      "code": "TITLE_DEED_ISSUANCE",
      "label": "Title deed issuance",
      "kind": "FLAT",
      "amountMinor": "58000"
    },
    {
      "code": "KNOWLEDGE_FEE",
      "label": "Knowledge fee",
      "kind": "FLAT",
      "amountMinor": "1000"
    },
    {
      "code": "INNOVATION_FEE",
      "label": "Innovation fee",
      "kind": "FLAT",
      "amountMinor": "1000"
    }
  ]
}
```

`config/fixtures/AE-DU.golden.json`:

```json
{
  "packId": "AE-DU",
  "cases": [
    {
      "name": "mortgaged apartment purchase",
      "input": {
        "propertyType": "APARTMENT",
        "transactionType": "SALE",
        "considerationMinor": "240000000",
        "marketValueMinor": "260000000",
        "attributes": { "mortgaged": true, "loanAmountMinor": 180000000 }
      },
      "expected": {
        "chargeableValueMinor": "240000000",
        "components": {
          "TRANSFER_FEE": "9600000",
          "MORTGAGE_REGISTRATION": "450000",
          "TITLE_DEED_ISSUANCE": "58000",
          "KNOWLEDGE_FEE": "1000",
          "INNOVATION_FEE": "1000"
        },
        "notApplied": [],
        "totalMinor": "10110000"
      }
    },
    {
      "name": "cash purchase, mortgage component does not apply",
      "input": {
        "propertyType": "APARTMENT",
        "transactionType": "SALE",
        "considerationMinor": "240000000",
        "marketValueMinor": "240000000",
        "attributes": { "mortgaged": false, "loanAmountMinor": 0 }
      },
      "expected": {
        "chargeableValueMinor": "240000000",
        "components": {
          "TRANSFER_FEE": "9600000",
          "TITLE_DEED_ISSUANCE": "58000",
          "KNOWLEDGE_FEE": "1000",
          "INNOVATION_FEE": "1000"
        },
        "notApplied": ["MORTGAGE_REGISTRATION"],
        "totalMinor": "9660000"
      }
    }
  ]
}
```

The first case is the one that proves `CONSIDERATION_ONLY` is really being applied: market value is AED 2,600,000 but the fee is computed on the AED 2,400,000 paid. Under Telangana's strategy the same input would charge on the higher figure.

- [ ] **Step 5: Run the harness and commit Dubai**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/packs.golden.test.ts
```

Expected: PASS — 4 packs.

```bash
git add config/jurisdictions/AE-DU-2026.1.json config/fixtures/AE-DU.golden.json
git commit -m "feat: add Dubai rule pack, exercising consideration-only basis and a conditional component"
```

- [ ] **Step 6: Write the California pack — stacked taxes, per-document flats, bounds, and a county sub-schedule**

`config/jurisdictions/US-CA-2026.1.json`:

```json
{
  "id": "US-CA",
  "jurisdictionLabel": "California, United States (synthetic)",
  "currency": "USD",
  "version": "2026.1",
  "timezone": "America/Los_Angeles",
  "provenance": "SYNTHETIC",
  "packSource": null,
  "packRetrievedAt": null,
  "basisStrategy": "CONSIDERATION_ONLY",
  "requiredAttributes": [
    {
      "name": "county",
      "kind": "string",
      "label": "County recorder",
      "options": ["Alameda", "Los Angeles", "San Diego"]
    },
    {
      "name": "documentCount",
      "kind": "number",
      "label": "Documents to record",
      "options": null
    }
  ],
  "components": [
    {
      "code": "COUNTY_TRANSFER_TAX",
      "label": "County documentary transfer tax",
      "kind": "PROPORTIONAL",
      "ratePpm": 1100,
      "rounding": "HALF_UP",
      "minAmountMinor": "1000"
    },
    {
      "code": "CITY_TRANSFER_TAX_ALAMEDA",
      "label": "City transfer tax — Alameda",
      "kind": "PROPORTIONAL",
      "ratePpm": 4500,
      "rounding": "HALF_UP",
      "condition": { "op": "eq", "attribute": "county", "value": "Alameda" }
    },
    {
      "code": "CITY_TRANSFER_TAX_LOS_ANGELES",
      "label": "City transfer tax — Los Angeles",
      "kind": "PROPORTIONAL",
      "ratePpm": 5650,
      "rounding": "HALF_UP",
      "condition": { "op": "eq", "attribute": "county", "value": "Los Angeles" }
    },
    {
      "code": "RECORDING_FEE",
      "label": "Recording fee",
      "kind": "FLAT",
      "amountMinor": "4750",
      "timesAttribute": "documentCount"
    },
    {
      "code": "AFFORDABLE_HOUSING_FEE",
      "label": "Affordable housing fee",
      "kind": "FLAT",
      "amountMinor": "3750",
      "timesAttribute": "documentCount",
      "maxAmountMinor": "22500"
    }
  ]
}
```

San Diego declares no city tax, which is deliberate: it proves a county can select *no* sub-schedule component without any special-casing.

`config/fixtures/US-CA.golden.json`:

```json
{
  "packId": "US-CA",
  "cases": [
    {
      "name": "Alameda, two documents, no bound binding",
      "input": {
        "propertyType": "HOUSE",
        "transactionType": "SALE",
        "considerationMinor": "85000000",
        "marketValueMinor": "85000000",
        "attributes": { "county": "Alameda", "documentCount": 2 }
      },
      "expected": {
        "chargeableValueMinor": "85000000",
        "components": {
          "COUNTY_TRANSFER_TAX": "93500",
          "CITY_TRANSFER_TAX_ALAMEDA": "382500",
          "RECORDING_FEE": "9500",
          "AFFORDABLE_HOUSING_FEE": "7500"
        },
        "notApplied": ["CITY_TRANSFER_TAX_LOS_ANGELES"],
        "totalMinor": "493000"
      }
    },
    {
      "name": "Los Angeles, eight documents, housing fee cap binds",
      "input": {
        "propertyType": "COMMERCIAL",
        "transactionType": "SALE",
        "considerationMinor": "85000000",
        "marketValueMinor": "85000000",
        "attributes": { "county": "Los Angeles", "documentCount": 8 }
      },
      "expected": {
        "chargeableValueMinor": "85000000",
        "components": {
          "COUNTY_TRANSFER_TAX": "93500",
          "CITY_TRANSFER_TAX_LOS_ANGELES": "480250",
          "RECORDING_FEE": "38000",
          "AFFORDABLE_HOUSING_FEE": "22500"
        },
        "notApplied": ["CITY_TRANSFER_TAX_ALAMEDA"],
        "totalMinor": "634250"
      }
    },
    {
      "name": "San Diego charges no city tax at all",
      "input": {
        "propertyType": "LAND",
        "transactionType": "SALE",
        "considerationMinor": "85000000",
        "marketValueMinor": "85000000",
        "attributes": { "county": "San Diego", "documentCount": 1 }
      },
      "expected": {
        "chargeableValueMinor": "85000000",
        "components": {
          "COUNTY_TRANSFER_TAX": "93500",
          "RECORDING_FEE": "4750",
          "AFFORDABLE_HOUSING_FEE": "3750"
        },
        "notApplied": ["CITY_TRANSFER_TAX_ALAMEDA", "CITY_TRANSFER_TAX_LOS_ANGELES"],
        "totalMinor": "102000"
      }
    },
    {
      "name": "a low-value transfer where the county tax minimum binds",
      "input": {
        "propertyType": "LAND",
        "transactionType": "GIFT",
        "considerationMinor": "500000",
        "marketValueMinor": "500000",
        "attributes": { "county": "Alameda", "documentCount": 2 }
      },
      "expected": {
        "chargeableValueMinor": "500000",
        "components": {
          "COUNTY_TRANSFER_TAX": "1000",
          "CITY_TRANSFER_TAX_ALAMEDA": "2250",
          "RECORDING_FEE": "9500",
          "AFFORDABLE_HOUSING_FEE": "7500"
        },
        "notApplied": ["CITY_TRANSFER_TAX_LOS_ANGELES"],
        "totalMinor": "20250"
      }
    }
  ]
}
```

Case four is the minimum in action: `500000 × 1100 / 1000000 = 550`, raised to the `1000` floor. Case two is the cap: `3750 × 8 = 30000`, capped at `22500`. Between them they prove both bounds bind in the right direction, which no other pack tests.

- [ ] **Step 7: Run the harness and commit California**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/packs.golden.test.ts
```

Expected: PASS — 5 packs.

```bash
git add config/jurisdictions/US-CA-2026.1.json config/fixtures/US-CA.golden.json
git commit -m "feat: add California rule pack with county sub-schedules, per-document fees and bounds"
```

- [ ] **Step 8: Write the Singapore pack — two stacked band schedules**

`config/jurisdictions/SG-2026.1.json`:

```json
{
  "id": "SG",
  "jurisdictionLabel": "Singapore (synthetic)",
  "currency": "SGD",
  "version": "2026.1",
  "timezone": "Asia/Singapore",
  "provenance": "SYNTHETIC",
  "packSource": null,
  "packRetrievedAt": null,
  "basisStrategy": "CONSIDERATION_ONLY",
  "requiredAttributes": [
    {
      "name": "residency",
      "kind": "string",
      "label": "Buyer status",
      "options": ["CITIZEN_FIRST_PROPERTY", "CITIZEN_SECOND_PROPERTY", "FOREIGNER"]
    }
  ],
  "components": [
    {
      "code": "BUYER_STAMP_DUTY",
      "label": "Buyer stamp duty",
      "kind": "PROGRESSIVE_BANDS",
      "rounding": "HALF_UP",
      "bands": [
        { "upToMinor": "18000000", "ratePpm": 10000 },
        { "upToMinor": "36000000", "ratePpm": 20000 },
        { "upToMinor": "100000000", "ratePpm": 30000 },
        { "upToMinor": null, "ratePpm": 40000 }
      ]
    },
    {
      "code": "ADDITIONAL_BUYER_STAMP_DUTY_SECOND",
      "label": "Additional buyer stamp duty — second property",
      "kind": "PROGRESSIVE_BANDS",
      "rounding": "HALF_UP",
      "condition": {
        "op": "eq",
        "attribute": "residency",
        "value": "CITIZEN_SECOND_PROPERTY"
      },
      "bands": [{ "upToMinor": null, "ratePpm": 2400 }]
    },
    {
      "code": "ADDITIONAL_BUYER_STAMP_DUTY_FOREIGNER",
      "label": "Additional buyer stamp duty — foreign buyer",
      "kind": "PROGRESSIVE_BANDS",
      "rounding": "HALF_UP",
      "condition": { "op": "eq", "attribute": "residency", "value": "FOREIGNER" },
      "bands": [{ "upToMinor": null, "ratePpm": 600000 }]
    },
    {
      "code": "ELECTRONIC_LODGEMENT_FEE",
      "label": "Electronic lodgement fee",
      "kind": "FLAT",
      "amountMinor": "50"
    }
  ]
}
```

`config/fixtures/SG.golden.json`:

```json
{
  "packId": "SG",
  "cases": [
    {
      "name": "citizen second property, both duty schedules stack",
      "input": {
        "propertyType": "APARTMENT",
        "transactionType": "SALE",
        "considerationMinor": "150000000",
        "marketValueMinor": "150000000",
        "attributes": { "residency": "CITIZEN_SECOND_PROPERTY" }
      },
      "expected": {
        "chargeableValueMinor": "150000000",
        "components": {
          "BUYER_STAMP_DUTY": "4460000",
          "ADDITIONAL_BUYER_STAMP_DUTY_SECOND": "360000",
          "ELECTRONIC_LODGEMENT_FEE": "50"
        },
        "notApplied": ["ADDITIONAL_BUYER_STAMP_DUTY_FOREIGNER"],
        "totalMinor": "4820050"
      }
    },
    {
      "name": "citizen first property pays base duty only",
      "input": {
        "propertyType": "APARTMENT",
        "transactionType": "SALE",
        "considerationMinor": "150000000",
        "marketValueMinor": "150000000",
        "attributes": { "residency": "CITIZEN_FIRST_PROPERTY" }
      },
      "expected": {
        "chargeableValueMinor": "150000000",
        "components": {
          "BUYER_STAMP_DUTY": "4460000",
          "ELECTRONIC_LODGEMENT_FEE": "50"
        },
        "notApplied": [
          "ADDITIONAL_BUYER_STAMP_DUTY_SECOND",
          "ADDITIONAL_BUYER_STAMP_DUTY_FOREIGNER"
        ],
        "totalMinor": "4460050"
      }
    },
    {
      "name": "foreign buyer, the second schedule dominates the first",
      "input": {
        "propertyType": "HOUSE",
        "transactionType": "SALE",
        "considerationMinor": "150000000",
        "marketValueMinor": "150000000",
        "attributes": { "residency": "FOREIGNER" }
      },
      "expected": {
        "chargeableValueMinor": "150000000",
        "components": {
          "BUYER_STAMP_DUTY": "4460000",
          "ADDITIONAL_BUYER_STAMP_DUTY_FOREIGNER": "90000000",
          "ELECTRONIC_LODGEMENT_FEE": "50"
        },
        "notApplied": ["ADDITIONAL_BUYER_STAMP_DUTY_SECOND"],
        "totalMinor": "94460050"
      }
    },
    {
      "name": "a value inside the first band only",
      "input": {
        "propertyType": "APARTMENT",
        "transactionType": "SALE",
        "considerationMinor": "18000000",
        "marketValueMinor": "18000000",
        "attributes": { "residency": "CITIZEN_FIRST_PROPERTY" }
      },
      "expected": {
        "chargeableValueMinor": "18000000",
        "components": {
          "BUYER_STAMP_DUTY": "180000",
          "ELECTRONIC_LODGEMENT_FEE": "50"
        },
        "notApplied": [
          "ADDITIONAL_BUYER_STAMP_DUTY_SECOND",
          "ADDITIONAL_BUYER_STAMP_DUTY_FOREIGNER"
        ],
        "totalMinor": "4460050"
      }
    }
  ]
}
```

**Executor note on case four.** The `totalMinor` above is deliberately WRONG — `180000 + 50` is `180050`, not `4460050`. Fix it to `"180050"` before running. It is here because a plan that hands you six fixture files invites you to paste rather than verify, and one arithmetic check is cheaper than a wrong fee in production. If your first run of the harness passes without you touching this line, the harness is not actually comparing totals and you should investigate that instead.

The `ELECTRONIC_LODGEMENT_FEE` of 50 minor units — half a Singapore cent short of a dollar — exists to prove a flat fee finer than the rate granularity survives rounding intact. It is the only reason the first case totals `4820050` rather than a round `4820000`.

- [ ] **Step 9: Run the harness and commit Singapore**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/packs.golden.test.ts
```

Expected: PASS — 6 packs, 19 cases.

```bash
git add config/jurisdictions/SG-2026.1.json config/fixtures/SG.golden.json
git commit -m "feat: add Singapore rule pack with two stacked band schedules"
```

- [ ] **Step 10: Confirm no engine code changed across all four packs**

```bash
git diff --name-only HEAD~4 HEAD -- payment-gateway/packages/domain/src
```

Expected: **empty output.** Four jurisdictions, spanning zero-decimal currency, consideration-only basis, conditional components, sub-schedules, per-document flats, minimums, caps, and stacked band schedules — added with no TypeScript change. That is the claim of FR-9 and success criterion 3a, verified rather than asserted.

If this command prints anything, the abstraction leaked. Record what forced the change and why in the commit message, and raise it before continuing.

---

## Task 14: Quote CLI

The deliverable that makes this plan working software rather than a library waiting for a server. It also serves plan 2: the HTTP quote endpoint will do exactly what this CLI does, with a request body instead of argv.

**Files:**
- Create: `payment-gateway/tools/quote.ts`
- Create: `payment-gateway/packages/domain/tests/fees/cli-contract.test.ts`

**Interfaces:**
- Consumes: `loadPackRegistry`, `DEFAULT_JURISDICTIONS_DIR`, `computeFee`, `formatMoney`, `fromWire`, `Money`.
- Produces: no importable API. A command:

```
npm run quote -- --all
npm run quote -- --jurisdiction IN-TG --consideration 480000000 --market 500000000
npm run quote -- --jurisdiction US-CA --consideration 85000000 --attr county=Alameda --attr documentCount=2
npm run quote -- --jurisdiction GB-ENG --consideration 39500000 --attr firstTimeBuyer=false --json
```

`--all` runs the first fixture case of every pack, so `npm run quote -- --all` is a one-command demonstration of six jurisdictions in six currencies.

- [ ] **Step 1: Write the failing contract test**

This tests the argument parsing and rendering as pure functions, so the CLI's logic is covered without spawning a process.

`payment-gateway/packages/domain/tests/fees/cli-contract.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { parseAttribute, parseArgs, renderBreakdown } from '../../../tools/quote.ts'
import { computeFee } from '../../src/fees/compute.ts'
import { loadPackRegistry, DEFAULT_JURISDICTIONS_DIR } from '../../src/fees/loader.ts'
import { Money } from '../../src/money/index.ts'

describe('parseAttribute', () => {
  it('parses a boolean', () => {
    expect(parseAttribute('firstTimeBuyer=true')).toEqual(['firstTimeBuyer', true])
    expect(parseAttribute('firstTimeBuyer=false')).toEqual(['firstTimeBuyer', false])
  })

  it('parses an integer', () => {
    expect(parseAttribute('documentCount=2')).toEqual(['documentCount', 2])
  })

  it('parses a string, including one with spaces', () => {
    expect(parseAttribute('county=Los Angeles')).toEqual(['county', 'Los Angeles'])
  })

  it('keeps a value containing = intact after the first separator', () => {
    expect(parseAttribute('note=a=b')).toEqual(['note', 'a=b'])
  })

  it('rejects a malformed pair', () => {
    expect(() => parseAttribute('county')).toThrow(/name=value/)
  })
})

describe('parseArgs', () => {
  it('parses a full quote invocation', () => {
    const parsed = parseArgs([
      '--jurisdiction',
      'US-CA',
      '--consideration',
      '85000000',
      '--attr',
      'county=Alameda',
      '--attr',
      'documentCount=2',
    ])
    expect(parsed).toMatchObject({
      mode: 'quote',
      jurisdictionId: 'US-CA',
      considerationMinor: '85000000',
      attributes: { county: 'Alameda', documentCount: 2 },
      json: false,
    })
  })

  it('defaults market value to the consideration when omitted', () => {
    const parsed = parseArgs(['--jurisdiction', 'JP', '--consideration', '60000000'])
    expect(parsed).toMatchObject({ marketValueMinor: '60000000' })
  })

  it('recognises --all', () => {
    expect(parseArgs(['--all']).mode).toBe('all')
  })

  it('recognises --json', () => {
    expect(parseArgs(['--all', '--json']).json).toBe(true)
  })

  it('rejects a quote with no jurisdiction', () => {
    expect(() => parseArgs(['--consideration', '1'])).toThrow(/--jurisdiction/)
  })

  it('rejects a quote with no consideration', () => {
    expect(() => parseArgs(['--jurisdiction', 'JP'])).toThrow(/--consideration/)
  })

  it('rejects a non-integer amount', () => {
    expect(() => parseArgs(['--jurisdiction', 'JP', '--consideration', '1.5'])).toThrow(
      /integer/i,
    )
  })

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--all', '--verbose'])).toThrow(/--verbose/)
  })
})

describe('renderBreakdown', () => {
  const registry = loadPackRegistry(DEFAULT_JURISDICTIONS_DIR)
  const pack = registry.get('JP')
  const breakdown = computeFee(
    {
      jurisdictionId: 'JP',
      propertyType: 'APARTMENT',
      transactionType: 'SALE',
      consideration: Money.of(60000000n, 'JPY'),
      marketValue: Money.of(60000000n, 'JPY'),
      attributes: {},
    },
    pack,
  )

  it('shows the total with no decimals for yen', () => {
    const rendered = renderBreakdown(breakdown, pack)
    expect(rendered).toContain('1,250,000')
    expect(rendered).not.toMatch(/1,250,000\.\d/)
  })

  it('names every component', () => {
    const rendered = renderBreakdown(breakdown, pack)
    expect(rendered).toContain('Registration and licence tax')
    expect(rendered).toContain('Judicial scrivener fee')
  })

  it('always carries the synthetic warning', () => {
    expect(renderBreakdown(breakdown, pack)).toMatch(/synthetic|illustrative/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/cli-contract.test.ts
```

Expected: FAIL — cannot resolve `../../../tools/quote.ts`.

- [ ] **Step 3: Write the CLI**

`payment-gateway/tools/quote.ts`:

```typescript
#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_JURISDICTIONS_DIR,
  type AttributeValue,
  type FeeBreakdown,
  type JurisdictionRulePack,
  type PropertyType,
  type TransactionType,
  Money,
  computeFee,
  formatMoney,
  fromWire,
  loadPackRegistry,
} from '../packages/domain/src/index.ts'

const FIXTURES_DIR = fileURLToPath(new URL('../../config/fixtures/', import.meta.url))

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
  const money = (wire: { amountMinor: string; currency: string }) =>
    formatMoney(fromWire(wire as never))

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

function main(argv: readonly string[]): number {
  let args: ParsedArgs
  try {
    args = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`)
    process.stderr.write(
      'Usage:\n' +
        '  quote --all [--json]\n' +
        '  quote --jurisdiction <id> --consideration <minor> [--market <minor>]\n' +
        '        [--attr name=value ...] [--property-type T] [--transaction-type T] [--json]\n',
    )
    return 2
  }

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
```

- [ ] **Step 4: Run the contract test to verify it passes**

```bash
cd payment-gateway/packages/domain && npx vitest run tests/fees/cli-contract.test.ts
```

Expected: PASS — 17 tests.

- [ ] **Step 5: Run the CLI against all six jurisdictions**

```bash
cd payment-gateway && npm run quote -- --all
```

Expected: six breakdowns. Check by eye that:
- Telangana shows `₹3,00,200.00` in Indian grouping
- England shows `£6,500.00` with three bands listed
- **Japan shows `¥1,250,000` with no decimal point at all**
- Dubai shows `AED 101,100.00`
- California shows `$4,930.00` with Los Angeles listed as not applied
- Singapore shows `S$48,200.50` with the foreigner duty not applied
- every one carries the synthetic warning

If Japan shows a decimal point, stop: that is success criterion 2 failing, and it means `formatMoney` is not reading the exponent.

- [ ] **Step 6: Verify the whole suite, the linter and the build**

```bash
cd payment-gateway && npm run lint && npm run build && npm test
```

Expected: all three clean.

- [ ] **Step 7: Commit**

```bash
git add payment-gateway/tools/quote.ts payment-gateway/packages/domain/tests/fees/cli-contract.test.ts
git commit -m "feat: add quote CLI demonstrating all six jurisdictions"
```

---

## Definition of done

This plan is complete when all of the following hold:

1. `npm run lint && npm run build && npm test` is clean from `payment-gateway/`.
2. `npm run quote -- --all` prints six breakdowns in six currencies, each carrying its synthetic disclaimer.
3. Japan's total renders as `¥1,250,000` — no decimal separator (spec success criterion 2).
4. Telangana's total renders as `₹3,00,200.00` in the lakh grouping convention.
5. `git diff --name-only HEAD~5 HEAD -- payment-gateway/packages/domain/src` is empty across the four pack commits — six jurisdictions, zero engine changes (FR-9, criterion 3a).
6. Both source guards pass, and each has been observed to fail when deliberately violated.
7. The golden harness has been observed to fail for a pack with no fixture file.
8. CI is green on the branch.

**Deliberately NOT done here**, and belonging to later plans: persistence, auth, HTTP, gateway adapters, webhooks, reconciliation, ledger, refunds, receipts, and UI.

---

## Self-review

**1. Spec coverage.** Every requirement in the plan's declared scope maps to a task:

| Requirement | Task |
|---|---|
| FR-0a Money value object, throws cross-currency | 4 |
| FR-0b per-currency minor units | 2 |
| FR-0c exponent classes 0, 2, 3 covered by test | 2, 5, 13 (JP) |
| FR-0d string wire format | 5 |
| FR-0e one currency per computation, fixed | 10 (`validateFeeInput`) |
| FR-1 pure engine, no jurisdiction branching | 10, and guarded in 11 |
| FR-2 jurisdiction-neutral input, pack-declared attributes | 7, 10 |
| FR-3 basis strategy named by the pack | 8 |
| FR-4 three component kinds | 9 |
| FR-5 self-explaining breakdown | 10 |
| FR-6 integer ratePpm | 4, 7 |
| FR-7 explicit per-component rounding, round then sum | 3, 9, 10, and pinned by the IN-TG third fixture |
| FR-8 versioned pack files, Zod-validated at boot | 7, 11 |
| FR-9 adding a jurisdiction needs no engine code | 12 harness, 13 step 10 |
| FR-10 blocking provenance guard | 7, and asserted for all packs in 12 |
| FR-11 six packs spanning different fee models | 12, 13 |
| FR-11b county sub-schedule, mortgage attribute | 13 (US-CA, AE-DU) |
| FR-12 quoting is side-effect free | 10 (pure function), 14 |
| NFR-1 no float money, lint-enforced | 6 |
| NFR-11 deterministic tests | 10 purity tests |
| M0 skeleton and CI | 1 |
| M1 money | 2, 3, 4, 5 |
| M2 fee engine and first pack | 7–12 |

`FR-11a`'s wired-versus-fixture tiering is **not** implemented here and correctly so: tiering is a routing concern, and routing arrives with the provider adapters in plan 4. All six packs load in this plan; which of them a citizen can pay through is decided later. Flagging it so plan 4 does not assume it was handled.

**2. Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Every code step carries the actual code. The two deliberate exceptions are labelled as such and are exercises, not gaps: Task 13 step 8's wrong `totalMinor`, and the `BROKEN` line in Task 6 step 4 and the `ZZ` pack in Task 12 step 6, all of which the plan instructs the executor to fix or delete.

**3. Type consistency.** Checked across tasks: `Money.of` / `Money.zero` / `Money.sum(parts, currency)` used consistently in 4, 9, 10, 12, 14. `computeComponent(rule, ctx)` returning `ComponentComputation | null` matches its consumer in 10. `PackRegistry.get/has/ids/all` as used by 12 and 14 matches 11. `toWire`/`fromWire` names stable across 5, 10, 14. `describeCondition` defined in 8 and used in 9 and 10. `readSourceFiles`/`stripComments` defined in 6 and reused in 11. `RoundingMode` union identical in 3, 4, 7. Fixture JSON shape identical in 12, 13, 14.

One genuine risk the executor should watch: `formatMoney`'s `Intl` call is the only place in the plan where I could not verify behaviour against a running Node, which is why Task 5 carries an explicit fallback instruction and a large-amount test rather than a bare assertion.
