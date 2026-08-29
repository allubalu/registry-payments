# Correctness strategy

How this repository proves the domain layer is right. See [README](../README.md) for the overview.

## Correctness strategy

Three mechanisms, each covering something the others cannot.

### 1. Boundary tests where the arithmetic is riskiest

Band boundaries are the highest-risk arithmetic in the system, so every bound in
a three-band schedule is pinned at **one minor unit below, exactly at, and one
above**:

```
149,999.99  → entirely 0% band          (below)
150,000.00  → entirely 0% band          (at — the bound is inclusive)
150,000.01  → one penny into the 2% band (above)
```

And the relief cliff, which is real behaviour in banded relief schemes. At
£425,000.00 a first-time buyer pays **no duty** (the £650.00 registry fee still
applies). One penny higher, relief vanishes entirely and standard duty applies to
the whole value:

```
consideration £425,000.00  →  duty £0.00      total £650.00
consideration £425,000.01  →  duty £6,750.00  total £7,400.00
```

A cliff worth £6,750 across one penny is exactly the kind of boundary a
hand-written test picks a round number either side of and misses.

### 2. The guards: tests that read the source

Two properties the spec states as blocking are properties of the **source text**,
not of any function's behaviour, and oxlint has no custom-rule facility. So they
are tests that scan `src/`:

| Guard | Forbids |
|---|---|
| `no-float-money` | `Number(x.amountMinor)`, `parseFloat`, hardcoded `/ 100`, float literals in a money or rate context, `Math.round` on an amount, and bare arithmetic on a minor amount outside the two money primitives |
| `no-jurisdiction-branch` | Any pack id, country name, or jurisdiction-specific literal anywhere in `src/fees` |

Both strip comments first — which is what lets `basis.ts` explain in prose *why*
India and England differ without tripping the guard. Documenting a jurisdictional
difference is right; branching on one is not.

**Both guards have been deliberately violated and observed to fail**, then pass
again. A guard that has never gone red is not a guard — and this is not
ceremony. The float guard passed on first write and would have shipped as
"working", but the planted violation revealed that its
hardcoded-divide-by-100 pattern was blind to `Number(m.amountMinor) / 100` —
the single most canonical form of the bug — because a closing paren sits between
the identifier and the operator.

### 3. Provenance is a blocking guard

```
provenance: "SOURCED"    → requires packSource (citation URL) AND
                           packRetrievedAt, or the boot throws
provenance: "SYNTHETIC"  → rates are illustrative; the label is suffixed
                           "(synthetic)", every breakdown carries
                           provenance and a disclaimer
```

There is no third state. A pack with unmarked rates fails to load, and the loader
throws on the **first** bad pack rather than collecting errors — a service that
starts with five of six jurisdictions turns an operator's deployment failure into
a citizen's 404.

### Test inventory

| Suite | Tests | Covers |
|---|---:|---|
| `fees/packs.golden` | 149 | 6 packs × 19 cases × 7 assertions |
| `money/money` | 36 | Arithmetic, cross-currency throws, ppm, clamping, exactness above 2⁵³ |
| `fees/components` | 28 | Three component kinds; every band boundary; bounds; rounding order |
| `fees/schema` | 21 | Zod validation, provenance guard, structural rules |
| `fees/compute` | 21 | Orchestration, breakdown shape, input validation, purity |
| `fees/cli-contract` | 16 | Argument parsing, attribute coercion, rendering |
| `fees/condition` | 14 | Eight operators, strict identity, throw-on-missing |
| `money/rounding` | 12 | Four modes, sign handling, coarse steps |
| `fees/loader` | 11 | Boot failures, duplicate ids, malformed JSON |
| `money/format` | 11 | Per-exponent formatting, locale grouping |
| `money/wire` | 11 | Round-trip, malformed input rejection |
| `guards/no-jurisdiction-branch` | 10 | Source scan for pack ids |
| `guards/no-float-money` | 7 | Source scan for float money |
| `fees/basis` | 7 | Three strategies, currency mismatch, negatives |
| `money/currency` | 5 | Registry, exponents, unknown codes |
| `smoke` | 1 | Package resolves |
| **Total** | **360** | |

---

