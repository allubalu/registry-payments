# Domain model — money and the fee engine

Deep reference for the pure domain layer. See [README](../README.md) for the overview.

## The money model

There is no bare numeric money type anywhere in the codebase.

```typescript
class Money {
  readonly amountMinor: bigint      // integer minor units, never a float
  readonly currency: CurrencyCode   // never optional, never inferred
}
```

Five decisions worth explaining, because each of them is a bug class closed:

### 1. `bigint` minor units, never floating point

`0.1 + 0.2 !== 0.3`. For a fee of ₹3,00,200 that error is invisible; summed
across a ledger it is a reconciliation failure. Every amount is an integer
number of the currency's smallest unit, and arithmetic is exact.

Rates are **integer parts-per-million**, not float percentages: `0.5%` is
`5000`, `4%` is `40000`. There is no `0.04` anywhere.

### 2. Minor units are per-currency, never assumed to be two

```typescript
INR, GBP, SGD, AED, USD → exponent 2
JPY                     → exponent 0     // the yen IS the minor unit
KWD, BHD                → exponent 3     // fils
```

Every format, parse, and rounding operation reads the exponent from the currency
registry. A hardcoded `/ 100` is a defect, and a guard test enforces that.
The test matrix mandates coverage of all three exponent classes.

### 3. Mixing currencies throws

```typescript
Money.of(100n, 'GBP').add(Money.of(100n, 'INR'))
// CurrencyMismatchError: Cannot add across currencies: GBP and INR.
// Mixing currencies is a defect, not a conversion — this system does no FX.
```

This system performs no FX and holds no rates. A cross-currency operation is
always a bug, so it fails loudly rather than producing a plausible number. The
ledger therefore balances **per currency**; there is no global total anywhere,
because summing across currencies is meaningless.

### 4. Rounding is explicit, named, and never implicit

```typescript
type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'CEIL' | 'FLOOR'
```

`CEIL` means toward +∞ and `FLOOR` means toward −∞ — *not* away from and toward
zero. That distinction is load-bearing because refunds are negative amounts.

The rule pack names the mode **per component**, and also the step: a
jurisdiction that rounds duty up to the whole currency unit sets
`roundToStepMinor` to `10^exponent` with `CEIL`.

**Components are rounded individually, then summed. Never summed then rounded.**
This is pinned by a fixture rather than trusted:

```
1234567 × 40000 ppm = 49382.68 → 49383
1234567 × 15000 ppm = 18518.50 → 18519
1234567 ×  5000 ppm =  6172.84 →  6173
flat                             20000
                              ────────
round-then-sum                   94075   ← the correct answer, pinned
sum-then-round                   94074   ← what a naive engine returns
```

### 5. Money crosses the wire as a string

JSON has no BigInt. `JSON.stringify(9007199254740993n)` throws, and coercing to
`Number` silently loses precision above 2⁵³.

```json
{ "amountMinor": "1250000", "currency": "JPY" }
```

The server never sends a *formatted* string as data, and the client never does
arithmetic. `FeeBreakdown` holds wire-shaped money at birth rather than `Money`
instances, so there is no path by which a `Money` reaches `JSON.stringify` and
serialises to `{}`.

---

## The fee engine

```typescript
computeFee(input: FeeInput, pack: JurisdictionRulePack): FeeBreakdown
```

Pure. No I/O, no clock, no randomness, no jurisdiction branching. Fully
unit-testable, and tested for determinism and input-immutability explicitly.

### Chargeable value is a pack decision, not a hardcoded rule

Jurisdictions genuinely differ on *what* the fee is charged on:

| Strategy | Used by | Behaviour |
|---|---|---|
| `MAX_OF_MARKET_AND_CONSIDERATION` | India | Charges the higher of assessed value and price paid |
| `CONSIDERATION_ONLY` | England, Japan, Dubai, California, Singapore | Charges the price actually paid |
| `MARKET_ONLY` | — | Available; no shipped pack uses it |

The pack names the strategy; the engine applies the named one. A Dubai fixture
proves this is real rather than incidental: market value is AED 2,600,000 but the
transfer fee computes on the AED 2,400,000 paid. The same input under India's
strategy would charge the higher figure.

### Three component shapes cover every real schedule

```typescript
type FeeComponentRule = FlatRule | ProportionalRule | ProgressiveBandsRule
```

- **`FLAT`** — a fixed amount, optionally multiplied by a numeric attribute
  (a per-document recording fee)
- **`PROPORTIONAL`** — `ratePpm` applied to the chargeable value, or to a named
  attribute instead (a mortgage fee charged on the loan, not the property)
- **`PROGRESSIVE_BANDS`** — ordered bands charged **marginally**, each on its own
  slice only

Plus, on every component: a `condition`, a `rounding` mode, a
`roundToStepMinor`, and optional `minAmountMinor` / `maxAmountMinor`.

Order of operations is **round, then bound**. A minimum is expressed in the
granularity the pack rounds to, so rounding afterwards could push a bounded
amount back below its own floor.

### Conditions are a closed eight-operator union

```typescript
type Condition =
  | { op: 'always' }
  | { op: 'eq';       attribute: string; value: string | number | boolean }
  | { op: 'lte' }     | { op: 'gte' }      // numeric attribute thresholds
  | { op: 'basisLte' }| { op: 'basisGte' } // thresholds on the chargeable value
  | { op: 'not';  of: Condition }
  | { op: 'all';  of: Condition[] }
  | { op: 'any';  of: Condition[] }
```

England's first-time-buyer relief is `all of (firstTimeBuyer eq true,
basisLte 42500000)` — and the *negation* of that same tree gates the standard
schedule, so the two are mutually exclusive by construction rather than by two
rules that must be kept in agreement.

**A missing attribute throws; it never evaluates false.** A silently-false
condition drops a fee component, which under-charges a statutory fee — the worst
direction for this to fail in, and invisible in the total.

`eq` uses strict identity, so the string `"true"` never equals the boolean
`true`. Form input arrives as strings often enough that coercion here would be a
live bug rather than a hypothetical one.

### Every breakdown explains itself

`FeeBreakdown` is designed so a citizen can verify the number without help. Each
component reports its basis, its rate, every band it walked with that band's
slice, and an `appliedRules` list naming each rule that fired — the condition it
satisfied, the rounding performed, and whether a bound bound:

```json
{
  "code": "AFFORDABLE_HOUSING_FEE",
  "applied": true,
  "amount": { "amountMinor": "22500", "currency": "USD" },
  "appliedRules": [
    { "code": "CONDITION",   "detail": "always applies" },
    { "code": "FLAT",        "detail": "flat 3750 minor units times documentCount = 8" },
    { "code": "MAX_APPLIED", "detail": "capped at the maximum of 22500 minor units" }
  ]
}
```

A bound appears in `appliedRules` only when it **actually bound** — a cap that
did not bite is not reported, because a breakdown listing every rule that
*could* have applied is noise rather than an explanation.

---

## Adding a jurisdiction

The claim is that a new jurisdiction costs one rule-pack file and one fixture
file, with no TypeScript change. It is verified rather than asserted:

```bash
$ git diff --name-only HEAD~5 HEAD -- packages/domain/src
$                     # empty
```

Those five commits added **Japan, Dubai, California and Singapore**. Between
them they exercise:

| Jurisdiction | What it forced the abstraction to handle |
|---|---|
| **JP** | A zero-decimal currency, where the minor unit is the major unit |
| **AE-DU** | `CONSIDERATION_ONLY` basis; a conditional component; a component charged on a named attribute (the loan) rather than the chargeable value |
| **US-CA** | Sub-jurisdictional variation — a county attribute selects a city-tax sub-schedule *inside one pack*; per-document multipliers; a minimum binding upward and a cap binding downward |
| **SG** | Two independent progressive schedules stacked on the same value; a flat fee finer than any rate granularity |

Eight JSON files. Zero lines of TypeScript. Any one of those would normally
arrive as `if (jurisdiction === 'JP')`.

The reason none did is an ordering decision: the pack schema was built with its
*whole* expressiveness surface up front — including operators no pack needed yet
— rather than grown per jurisdiction. Had the schema grown incrementally, each
new jurisdiction would have found it one feature short, and the shortfall would
have gone into code.

### The mechanism that keeps it honest

The golden test suite discovers packs by **reading the directory**, so a pack
added without fixtures fails CI. "Adding a jurisdiction is a JSON file" is only
true if the JSON file is also verified.

```
config/
  jurisdictions/IN-TG-2026.1.json      ← the rules
  fixtures/IN-TG.golden.json           ← 19 cases across 6 packs, pinning
                                         chargeable value, every component
                                         amount, which components did NOT
                                         apply, and the total
```

The `notApplied` assertion is what makes these regression tests rather than total
checks: it pins *which* rules fired, so a condition that silently starts matching
everything is caught even when the total happens to be unchanged.

---

