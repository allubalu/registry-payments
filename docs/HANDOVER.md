# Handover — pick this up on another machine

Everything needed to resume work with no memory of the previous session.
Written 2026-08-31, at the end of Plan 3.

---

## 1. Where the project stands

**Plans 1 and 3 are complete.** Plan 1 built the pure domain layer; Plan 3 put
an HTTP API and a React client on top of it. Nothing is half-finished; there is
no work in progress and no stash to recover.

| Built | Not built |
|---|---|
| `Money` value object, currency registry, rounding | Persistence (Prisma, SQLite) |
| Fee engine (`computeFee`), rule pack loader, Zod schemas | Applications, state machine, expiry, ledger |
| Six jurisdiction rule packs + golden fixtures | Auth (users, bcrypt, JWT, ownership guards) |
| Quote CLI (`tools/quote.ts`) | `PaymentProvider` port and adapters |
| **HTTP API** — `GET /api/jurisdictions`, `POST /api/fees/quote` | Webhooks, idempotency, reconciliation |
| **React client** — pack-driven quote page, all six jurisdictions | Refunds, receipt PDF |
| 451 tests across 23 suites | Clerk queue, admin console |
| GitHub Actions CI (typecheck, lint, test, client build) | Playwright E2E |
| 15 static design artboards (`design/`) | |

By the PRD's milestone list, **4 of 12 milestones are done** (M1, M2, M6, M6b),
plus the pack-driven form metadata and quote endpoint from M3 — the rest of M3
(applications, state machine, expiry) needs persistence first.

The design artboards remain hand-authored static HTML mockups. The React client
is a separate, working app; it does not render them.

---

## 2. First fifteen minutes on the new machine

```bash
git clone https://github.com/allubalu/registry-payments.git
cd registry-payments
npm install
npm test
```

Expect **451 passed** across 23 files — 360 domain, 49 api, 42 web. If that
holds, the environment is good.

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
npm test          # 451 tests across three workspaces
npm run lint      # oxlint, silent on success
npm run typecheck # tsc over domain, api and web; silent on success
npm run quote -- --all
npm run build:web # the only package with a build step
```

To see it in a browser, two terminals:

```bash
npm run dev:api   # Express on :4000
npm run dev:web   # Vite on :5173, proxies /api — no CORS anywhere
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

**Plan 2 — persistence — is next, and there is no longer an argument against it.**
Prisma schema, application state machine, expiry, the append-only ledger.

Three of the hardest guarantees in the PRD are *database constraints*, not code.
The partial unique index
`UNIQUE(applicationId) WHERE status IN ('AUTHORIZED','CAPTURED')` is what makes
a double-charge structurally impossible; `UNIQUE(provider, providerEventId)` is
what makes webhook replay a no-op. Writing payment logic before those exist
means writing idempotency twice — once in TypeScript, once in the schema — and
ending up with two enforcement layers where one belongs.

Plan 3 was taken first because it touches no payment state, so it created none
of that rework. That shortcut is now spent: everything remaining involves money
changing state, and the schema should come first.

### What Plan 3 leaves you

- `createApp(registry)` in `packages/api/src/app.ts` takes an already-loaded
  registry and never listens, so tests run the real app in-process. Add routes
  there; add a `DbContext`-style dependency the same way.
- `packages/api/src/errors.ts` is the single error→status mapper. New domain
  errors get a case there and nowhere else.
- The 400/422 split is load-bearing: 400 for a malformed body, 422 when the
  domain refuses a well-formed one. Keep it when applications arrive.
- `packages/web/src/money.ts` needs no currency table — `Intl.NumberFormat`
  supplies per-currency exponents and formats decimal *strings* at arbitrary
  precision. Do not reintroduce a table, and never route an amount through a JS
  number.
- The no-jurisdiction-branch guard now covers `packages/api/src` and
  `packages/web/src`. Any new package should be added to `SCANNED_DIRECTORIES`
  in `packages/api/tests/guards/no-jurisdiction-branch.test.ts`.

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
├── packages/api/               HTTP. Express; no persistence, no auth.
│   ├── src/app.ts               createApp(registry) — never listens
│   ├── src/errors.ts            the one error → status mapper
│   ├── src/routes/              jurisdictions · quote
│   └── tests/                   49 tests, incl. the api+web guard
├── packages/web/               React 19 + Vite. Talks HTTP only.
│   ├── src/components/          AttributeFields is the whole argument
│   ├── src/money.ts             MoneyWire → glyphs, no JS numbers
│   └── tests/                   42 tests (jsdom)
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

Added by Plan 3:

- **Testing Library's auto-cleanup does not register when vitest `globals` is
  off.** These suites import `describe`/`it`/`expect` explicitly, so `cleanup`
  must be wired by hand in `packages/web/tests/setup.ts`. Without it, mounted
  trees accumulate and every `getBy*` from the second test onward silently
  matches the *previous* test's DOM — the failure reads as "found multiple
  elements", which sounds like a component bug and is not.
- **`Intl.NumberFormat.format` accepts a decimal string at runtime, but
  TypeScript types the parameter as `` `${number}` ``.** A string built at
  runtime cannot be narrowed to that template type, so `formatMoney` carries one
  documented `as Intl.StringNumericLiteral` downcast. Do not "fix" it by passing
  a `Number` — that is the precision bug the string exists to prevent.
- **oxlint's `no-console` is an error in this repo.** Use
  `process.stdout.write` / `process.stderr.write`, as `tools/quote.ts` does.
- **`resolvedOptions().maximumFractionDigits` is typed `number | undefined`**
  even for `style: 'currency'`. It is always present at runtime; the fallback in
  `fractionDigits` exists to satisfy the type, not to paper over a real case.
- **`form_input` on a checkbox does not fire React's change handler.** When
  driving the UI from a browser tool, click checkboxes rather than setting them.
  This cost a confusing "required attribute missing" 422 that was the harness,
  not the app.

---

## 8. Repository facts

| | |
|---|---|
| Remote | `https://github.com/allubalu/registry-payments` (public) |
| Default branch | `main` |
| Commits | all authored `Prasanna Allu <41278750+allubalu@users.noreply.github.com>` |
| Merged PRs | #1 domain layer · #2 demo GIFs · #3 handover |
| CI | GitHub Actions — lint, typecheck, test, client build, on push and PR |
| Stale remote branches | `feat/money-and-fee-engine`, `docs/demo-gifs` and `docs/handover` are merged and can be deleted |
| Known gap | No screenshot or GIF of the React client yet — the README describes it in text. Capturing one needs a headless browser the repo does not yet depend on. |

No secrets are in the repository or its history. There is no `.env` file and
none is needed yet — the first one arrives with the gateway adapters, and
`.env` is already gitignored.
