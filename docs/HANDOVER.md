# Handover — pick this up on another machine

Everything needed to resume work with no memory of the previous session.
Written 2026-08-31, at the end of Plan 1.

---

## 1. Where the project stands

**Plan 1 (the pure domain layer) is complete and merged to `main`.** Nothing is
half-finished; there is no work in progress and no stash to recover.

| Built | Not built |
|---|---|
| `Money` value object, currency registry, rounding | Persistence (Prisma, SQLite) |
| Fee engine (`computeFee`), rule pack loader, Zod schemas | HTTP layer (Express, routes, Zod validation) |
| Six jurisdiction rule packs + golden fixtures | Auth (users, bcrypt, JWT, ownership guards) |
| Quote CLI (`tools/quote.ts`) | `PaymentProvider` port and adapters |
| 360 tests across 16 suites | Webhooks, idempotency, reconciliation |
| GitHub Actions CI (typecheck, lint, test) | Refunds, ledger, receipt PDF |
| 15 static design artboards (`design/`) | **React UI — no `.tsx` file exists yet** |

By the PRD's milestone list, **4 of 12 milestones are done** (M1, M2, M6, M6b).
The design artboards are hand-authored static HTML mockups, not a running app.

---

## 2. First fifteen minutes on the new machine

```bash
git clone https://github.com/allubalu/registry-payments.git
cd registry-payments
npm install
npm test
```

Expect **360 passed (16 files)**. If that holds, the environment is good.

### Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Node.js | **24.20.0** | Must be ≥ 22.6. The repo has **no build step** — packages export `src/*.ts` directly and run under `--experimental-strip-types`. An older Node cannot execute the source at all. |
| npm | 11.19.0 | Workspaces are used. |
| Python + Pillow | 3.12 | **Only** to regenerate the README GIFs. Not needed to build, test or run. |

### Set the git identity before your first commit

The history was rewritten once to remove a work email. Do not reintroduce one:

```bash
git config user.name "Prasanna Allu"
git config user.email "41278750+allubalu@users.noreply.github.com"
```

This is repo-local config and does **not** travel with a clone, so it must be
set again on every machine. The global config on the original machine points at
a work address, which is exactly the trap this guards against.

Check `gh auth status` too — pushing needs the `allubalu` account active, and
its token needs the `workflow` scope or any push touching
`.github/workflows/` is rejected:

```bash
gh auth switch --user allubalu
gh auth refresh -h github.com -s workflow   # only if the scope is missing
```

---

## 3. Verifying it actually works

```bash
npm test          # 360 tests, ~11s
npm run lint      # oxlint, silent on success
npm run typecheck # tsc, silent on success
npm run quote -- --all
```

Note the `--` before CLI flags: npm swallows them otherwise.

Four checks that prove the claims rather than restating them:

```bash
# The central claim: adding a jurisdiction touched no engine code.
# Diff from just before the Dubai pack to just after the Singapore pack.
# Anchored on commit messages so it keeps working as history grows.
git diff --name-only \
  "$(git log --format=%H --grep='add Dubai rule pack')^" \
  "$(git log --format=%H --grep='add Singapore rule pack')" \
  -- packages/domain/src
# Output must be empty. Those commits touched only config/, tests/ and the CLI.

# A sub-jurisdictional attribute changes the fee with no new pack.
npm run quote -- --jurisdiction US-CA --consideration 85000000 --attr county="Los Angeles" --attr documentCount=3
npm run quote -- --jurisdiction US-CA --consideration 85000000 --attr county=Alameda --attr documentCount=3

# A one-minor-unit cliff in England.
npm run quote -- --jurisdiction GB-ENG --consideration 42500000 --attr firstTimeBuyer=true
npm run quote -- --jurisdiction GB-ENG --consideration 42500001 --attr firstTimeBuyer=true

# The guards, which read src/ as text.
npm test -- no-float-money
npm test -- no-jurisdiction-branch
```

To see the provenance guard refuse to boot, delete the `provenance` key from
any pack in `config/jurisdictions/` and run any quote. It fails for the whole
registry, even when the requested jurisdiction is a different one. Restore the
file afterwards.

---

## 4. Decisions already taken — do not relitigate these

Settled during requirements. Changing one means changing the PRD.

| Decision | Choice |
|---|---|
| Domain | Government property registration fees (stamp duty + registration) |
| Stack | Node + React |
| Gateways | Stripe primary, Razorpay routed for `IN-*` (Razorpay cannot charge GBP/JPY/AED) |
| Jurisdictions | All six: `IN-TG`, `GB-ENG`, `JP`, `AE-DU`, `US-CA`, `SG` |
| Rate provenance | **All `SYNTHETIC`**, banner-marked in UI, API and receipt |
| Persistence | SQLite via Prisma, schema portable to Postgres |
| Auth | Seeded users, email + password, bcrypt, JWT — no SSO, no MFA |
| Notifications | **Out of scope**, and therefore no queue and no outbox |
| UI fidelity | Static hi-fi mockups for now; split light citizen / dark ops |
| Repo | Standalone public repo `allubalu/registry-payments` |

Architectural invariants that later plans must not break:

1. **The domain layer has zero I/O.** No clock, no randomness, no database. If
   something in `packages/domain/src` needs the time, it takes it as an argument.
2. **Jurisdiction is data; provider is code.** They meet only in routing config.
   A jurisdiction id must never appear in engine source — a guard test enforces it.
3. **One writer for payment state.** The webhook handler and the reconciler must
   call the same `applyPaymentEvent`. Two code paths mutating money state is the
   bug the design exists to prevent.
4. **No float arithmetic on money, anywhere.** A guard test greps for it.
5. **Never sum across currencies.** All aggregates group by currency.

---

## 5. What to do next

Three plans stand between here and a clickable browser UI. Two sensible orders:

**A. Honest build order — start with Plan 2 (persistence).**
Prisma schema, application state machine, expiry, the append-only ledger.

The argument for going first: three of the hardest guarantees in the PRD are
*database constraints*, not code. The partial unique index
`UNIQUE(applicationId) WHERE status IN ('AUTHORIZED','CAPTURED')` is what makes
a double-charge structurally impossible; `UNIQUE(provider, providerEventId)` is
what makes webhook replay a no-op. Writing payment logic before those exist
means writing idempotency twice — once in TypeScript, once in the schema — and
ending up with two enforcement layers where one belongs.

**B. Shortcut to something clickable — Plan 3 plus a thin React quote page.**
Express with `GET /api/jurisdictions` and `POST /api/fees/quote`, then a Vite +
React page: jurisdiction picker, pack-driven form, live breakdown. No database,
no payments, no auth. Roughly a third of the work of A, and it demos the most
distinctive property of the system — a form whose fields come from a rule pack
rather than from a per-country component.

Whichever comes first, the HTTP layer is cheap because `FeeBreakdown` already
serialises to `MoneyWire` (`{amountMinor: "1250000", currency: "JPY"}`). The
response body is the domain object with no mapping layer, and the client
formats with `Intl.NumberFormat` off the currency code. That is why
`FeeBreakdown` holds `MoneyWire` rather than `Money` — it looked odd when it
was written and it was written for this.

`validateFeeInput` in `src/fees/compute.ts` is already exported for the HTTP
layer to reuse, so request validation and engine validation cannot drift.

### Writing the next plan

Plans live in `docs/superpowers/plans/`. The Plan 1 file is a worked example of
the expected shape: numbered tasks, bite-sized steps, explicit verification
after each, and deliberate failure exercises that test the plan itself.

Plans 2–6 were left unwritten on purpose: their interfaces should be authored
against signatures that have actually run, not signatures that were imagined.
`computeFee` and `FeeBreakdown` have now run a few hundred times, so the API
contract that wraps them can be designed from fact.

---

## 6. Map of the repository

```
registry-payments/
├── README.md                    Strategic overview — diagrams, tech stack, proof
├── config/
│   ├── jurisdictions/           6 versioned rule packs (DATA — the only place
│   │                            jurisdiction knowledge lives)
│   └── fixtures/                6 golden files, 19 pinned cases
├── packages/domain/             The pure layer. No I/O.
│   ├── src/money/               currency · money · rounding · format · wire
│   ├── src/fees/                types · schema · condition · basis
│   │                            components · compute · loader
│   └── tests/
│       ├── money/  fees/        343 behavioural tests
│       └── guards/              17 tests that read src/ as text
├── tools/
│   ├── quote.ts                 The CLI
│   └── render-demo-gifs.py      Regenerates the README GIFs from real output
├── docs/
│   ├── ARCHITECTURE.md          Layer boundaries, pluggability axes
│   ├── DOMAIN-MODEL.md          Money decisions, basis strategies, conditions
│   ├── TESTING.md               Guards, boundary testing, suite inventory
│   ├── ENGINEERING-NOTES.md     Toolchain findings, known limitations
│   ├── HANDOVER.md              This file
│   ├── assets/                  README GIFs
│   └── superpowers/
│       ├── specs/               The PRD — requirements, journeys, API surface
│       └── plans/               Plan 1 (executed). Plans 2+ go here.
└── design/                      15 static .dc.html artboards + canvas.json
```

---

## 7. Traps already hit, so you do not hit them twice

These cost time on the first machine. All are documented at more length in
[ENGINEERING-NOTES.md](ENGINEERING-NOTES.md).

- **`tsc` exiting 0 over output that cannot be imported.** Node's type stripping
  rejects constructor parameter properties (`constructor(readonly x: T)`) with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. `erasableSyntaxOnly: true` is set in
  `tsconfig.base.json` to turn that into a compile error. Declare fields
  explicitly.
- **`rewriteRelativeImportExtensions` rewrites `import ... from './x.ts'` but
  not `export ... from './x.ts'`.** Barrel files are the place this bites.
- **npm swallows CLI flags.** `npm run quote -- --all`, never `npm run quote --all`.
- **`convert` on Windows PATH is the filesystem converter, not ImageMagick.**
  Do not invoke it.
- **No locale × `currencyDisplay` combination renders SGD as `S$`.** It renders
  as `$`, same as USD. Known limitation, not worked around.
- **Golden fixtures must be read defensively at collection time.** An unguarded
  `readFileSync` throws before any assertion exists, so vitest fails the whole
  file with a raw ENOENT and reports "no tests" — taking every other pack's
  cases down with it.

---

## 8. Repository facts

| | |
|---|---|
| Remote | `https://github.com/allubalu/registry-payments` (public) |
| Default branch | `main` |
| Commits | 20, all authored `Prasanna Allu <41278750+allubalu@users.noreply.github.com>` |
| Merged PRs | #1 domain layer · #2 demo GIFs |
| CI | GitHub Actions — typecheck, lint, test on push and PR. Green. |
| Stale local branches | `feat/money-and-fee-engine` and `docs/demo-gifs` are merged and can be deleted; they do not exist on a fresh clone |

No secrets are in the repository or its history. There is no `.env` file and
none is needed yet — the first one arrives with the gateway adapters, and
`.env` is already gitignored.
