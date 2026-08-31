# HTTP API and Quote UI Implementation Plan

Plan 3. Wraps the completed domain layer in an HTTP surface and puts a browser
in front of it. Written 2026-08-31, against signatures that have actually run.

**Scope:** `GET /api/jurisdictions`, `POST /api/fees/quote`, and a React page
that quotes a fee in any of the six jurisdictions.

**Explicitly out of scope:** persistence, applications, auth, payments,
webhooks, receipts. No database. Nothing here writes anything down.

The point of doing this before persistence: it is the shortest path to the
system's most distinctive property being visible in a browser — **a form whose
fields come from a rule pack rather than from a per-country component.** It
touches no payment state, so it creates none of the double-implementation risk
that argues for schema-first ordering.

---

## Global Constraints

Inherited from [Plan 1](2026-08-25-money-and-fee-engine.md) and the
[PRD](../specs/2026-08-25-property-registration-payments-prd.md). Every task's
requirements implicitly include this section.

- **Package manager is npm**, workspaces under `packages/*`. Never pnpm or yarn.
- **Linter is oxlint.** Never eslint. `npm run lint` covers `packages tools`.
- **TypeScript `strict`** plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `erasableSyntaxOnly`.
  No `any`; no `@ts-expect-error` without a comment naming the reason.
- **FR-0d — Money crosses every boundary as `{ amountMinor: string, currency: string }`.**
  Never a JS `Number`, in a request or a response. `FeeBreakdown` already holds
  `MoneyWire`, so the response body is the domain object with no mapping layer.
- **FR-0b — minor units are per-currency.** The client formats with
  `Intl.NumberFormat` off the currency code and never divides by 100.
- **FR-1 — no jurisdiction-specific branching**, now extended to the new
  packages: a `grep` for any pack id inside `packages/api/src` or
  `packages/web/src` must return nothing. Task 8 enforces this with a guard test.
- **FR-12 — quoting is side-effect free and idempotent.** Same body in, same
  body out, nothing persisted.
- **FR-10 — provenance is blocking and visible.** Every quote response carries
  its `disclaimer`, and the UI renders it where the number is read, not in a
  footer.
- **No engine changes.** `packages/domain/src` must be byte-identical at the end
  of this plan. If the HTTP layer wants something the domain does not expose,
  that is a finding to report, not a patch to apply.
- **Validation is not duplicated.** `validateFeeInput` is already exported for
  this purpose. The HTTP layer parses shapes; the domain decides legality.
- **Commit style:** Conventional Commits. Author
  `Prasanna Allu <41278750+allubalu@users.noreply.github.com>`.

---

## File Structure

```
packages/
  api/
    package.json                 @registry/api — express, zod; vitest + supertest
    tsconfig.json
    src/
      app.ts                     createApp(registry) → Express app, never listens
      server.ts                  entry point: loads registry, listens
      errors.ts                  domain error → HTTP status mapping
      schemas.ts                 Zod request shapes (shape only, not legality)
      routes/
        jurisdictions.ts         GET /api/jurisdictions
        quote.ts                 POST /api/fees/quote
    tests/
      jurisdictions.test.ts
      quote.test.ts
      errors.test.ts
      guards/no-jurisdiction-branch.test.ts
  web/
    package.json                 @registry/web — react, vite; vitest + jsdom + RTL
    tsconfig.json
    vite.config.ts               dev proxy /api → 4000, so no CORS anywhere
    index.html
    src/
      main.tsx
      App.tsx                    picker + form + breakdown
      api.ts                     typed fetch wrappers
      money.ts                   MoneyWire → display string, per-currency
      components/
        JurisdictionPicker.tsx
        AttributeFields.tsx      renders requiredAttributes — the whole point
        Breakdown.tsx            components, bands, total
        ProvenanceBanner.tsx
      styles.css
    tests/
      attribute-fields.test.tsx
      money.test.ts
      breakdown.test.tsx
```

`api` depends on `@registry/domain`. `web` depends on nothing from the
workspace — it talks HTTP, and its types come from the wire, so a type error
cannot hide a contract break. That is deliberate: it keeps the client honest
about the fact that it only ever sees JSON.

---

## Task 1: API workspace skeleton

**Requirements.** A `@registry/api` workspace that type-checks, lints and runs
its own vitest suite. `createApp(registry)` returns a configured Express app and
never calls `listen`; `server.ts` owns the port. `GET /api/health` returns
`{status:'ok', jurisdictions:<count>}`.

Separating `createApp` from `server.ts` is what makes every later test able to
run the real app in-process with no port and no teardown.

**Steps.**
1. Create `packages/api/package.json` with `express`, `zod`; dev `vitest`,
   `supertest`, `@types/express`, `@types/supertest`.
2. Create `packages/api/tsconfig.json` extending `tsconfig.base.json`.
3. Write `src/app.ts` with the health route only.
4. Write `src/server.ts`: `loadPackRegistry(DEFAULT_JURISDICTIONS_DIR)`, listen
   on `PORT ?? 4000`.
5. Add root scripts: `dev:api`, and extend `typecheck` to cover the new package.

**Verification.**
```bash
npm install
npm run typecheck
npm run lint
npm test                      # domain 360 still green, api suite runs
npm run dev:api &             # then:
curl -s localhost:4000/api/health
```
Expect `{"status":"ok","jurisdictions":6}`.

**Failure exercise.** Point `loadPackRegistry` at a directory with one pack
whose `provenance` key is deleted. The server must fail to boot rather than
serve five packs — the provenance guard is registry-wide, and Task 1 must not
have softened it into a per-request check.

---

## Task 2: Error mapping and request schemas

**Requirements.** One place that turns a domain error into a status code:

| Condition | Status | Body |
|---|---|---|
| Body fails Zod shape parse | 400 | `{error:'INVALID_REQUEST', detail, issues}` |
| Unknown `jurisdictionId` | 404 | `{error:'UNKNOWN_JURISDICTION', detail}` |
| `FeeInputError` from the domain | 422 | `{error:'INVALID_FEE_INPUT', detail}` |
| `InvalidMoneyWireError` | 400 | `{error:'INVALID_MONEY', detail}` |
| Anything else | 500 | `{error:'INTERNAL', detail:'…'}` — no stack, no leak |

422 rather than 400 for `FeeInputError` is the distinction worth keeping: the
request was well-formed JSON of the right shape, and the *domain* rejected it —
a missing required attribute, a currency that is not the pack's. The client can
tell "I sent nonsense" from "the pack says no".

**Steps.**
1. `src/errors.ts`: an `HttpError` shape, a `toHttpError(unknown)` mapper, and
   an Express error handler that never emits a stack.
2. `src/schemas.ts`: `MoneyWireSchema` (`amountMinor` a digit string, `currency`
   3 uppercase letters), `QuoteRequestSchema`.
3. Unit-test the mapper directly, not only through routes.

**Verification.** `npm test -- errors`. Every row of the table above has a test.

**Failure exercise.** Throw a raw `Error('db password is hunter2')` from a route
and assert the response body contains neither the message nor a stack.

---

## Task 3: `GET /api/jurisdictions`

**Requirements.** Public, no body. Returns every loaded pack as
`{id, jurisdictionLabel, currency, provenance, basisStrategy, requiredAttributes, version}`.
Deliberately **not** the whole pack — `components` is the rate schedule, and the
client does not need it to render a form. Sorted by `id` for a stable UI.

**Steps.**
1. `src/routes/jurisdictions.ts`, projecting from `registry.all()`.
2. Register in `createApp`.
3. Tests: 6 packs; sorted; every pack carries `requiredAttributes`; `US-CA`
   exposes a `county` attribute with `options` non-null; no `components` key
   anywhere in the response.

**Verification.**
```bash
curl -s localhost:4000/api/jurisdictions | python3 -m json.tool | head -40
```

---

## Task 4: `POST /api/fees/quote`

**Requirements.** Body:

```json
{
  "jurisdictionId": "US-CA",
  "propertyType": "APARTMENT",
  "transactionType": "SALE",
  "consideration": { "amountMinor": "85000000", "currency": "USD" },
  "marketValue":   { "amountMinor": "85000000", "currency": "USD" },
  "attributes":    { "county": "Los Angeles", "documentCount": 3 }
}
```

`marketValue` is optional and defaults to `consideration`, matching the CLI, so
single-basis jurisdictions need not send it twice. Response is the
`FeeBreakdown` verbatim. No side effects.

**Steps.**
1. Parse with `QuoteRequestSchema`; 404 early if the jurisdiction is unknown.
2. `fromWire` both money values, build `FeeInput`, call `validateFeeInput` then
   `computeFee`. Let `errors.ts` map anything thrown.
3. Tests, each asserting against a number the golden fixtures already pin:
   - `IN-TG` derived basis; `JP` zero-decimal total has no minor digits.
   - The England £1 cliff: `42500000` vs `42500001` with `firstTimeBuyer=true`
     differ by the relief.
   - `US-CA` with `county=Los Angeles` vs `county=Alameda` differ.
   - Missing required attribute → 422.
   - Currency that is not the pack's → 422.
   - Unknown jurisdiction → 404.
   - **Idempotence:** the same body twice yields byte-identical JSON.

**Verification.** `npm test -- quote`, plus a curl of the two England bodies
showing the cliff over HTTP.

**Failure exercise.** Send `"consideration": {"amountMinor": 85000000}` — a
JSON number, not a string. Must be 400, never a silent coercion. This is the
FR-0d boundary and it must fail loudly.

---

## Task 5: Web workspace skeleton

**Requirements.** Vite + React + TS in `packages/web`, dev server proxying
`/api` to `:4000`. `npm run dev:web` serves a page that fetches
`/api/jurisdictions` and lists the six ids. Vitest with jsdom for components.

This package is the first `.tsx` in the repository.

**Steps.**
1. `package.json` (react, react-dom; dev vite, @vitejs/plugin-react, vitest,
   jsdom, @testing-library/react, @testing-library/jest-dom).
2. `vite.config.ts` with the `/api` proxy and the vitest jsdom environment.
3. `index.html`, `src/main.tsx`, a minimal `App.tsx`.
4. Root scripts `dev:web` and `dev` (api + web together).

**Verification.** `npm run dev:web`, load `localhost:5173`, see six ids. Then
`npm run lint` and `npm run typecheck` still clean.

**Note.** `web` has a real build step, unlike every other package. That is
expected and does not change the no-build rule for `domain` and `api`.

---

## Task 6: The pack-driven form

**Requirements.** `AttributeFields.tsx` renders inputs from
`requiredAttributes` alone:

| `kind` | Control |
|---|---|
| `string` with `options` | `<select>` of those options |
| `string` without options | text input |
| `number` | number input |
| `boolean` | checkbox |

**There is no per-jurisdiction component, and no `switch` on a pack id.** Adding
a seventh jurisdiction must change nothing in this directory — that is the
property being demonstrated, and Task 8 guards it.

Changing jurisdiction resets attribute state, because attribute names do not
carry across packs and stale keys would be sent to the wrong pack.

**Steps.**
1. `JurisdictionPicker.tsx` — select over the fetched list.
2. `AttributeFields.tsx` — the table above, driven by props.
3. Consideration input in **major units**, converted to minor on submit using
   the pack's currency exponent. A JPY pack must show no decimal input.
4. Component tests: a `US-CA` pack renders a county `<select>` with its options
   and a numeric `documentCount`; a `GB-ENG` pack renders a `firstTimeBuyer`
   checkbox; switching packs clears prior values.

**Verification.** `npm test -- attribute-fields`, and in the browser: pick each
of the six jurisdictions and watch the form change shape.

---

## Task 7: Breakdown and provenance

**Requirements.** `Breakdown.tsx` renders the response: each component with its
label, amount, and — when present — its bands and `appliedRules`; components
that did not apply shown as "not applied" rather than hidden, because *why a
relief did not fire* is the interesting part. Total last, formatted per currency.

`ProvenanceBanner.tsx` renders `disclaimer` adjacent to the total. Non-dismissible.

`money.ts` formats `MoneyWire` via `Intl.NumberFormat` and the currency's
exponent. It must never divide by 100. It carries the known SGD limitation from
[ENGINEERING-NOTES.md](../../ENGINEERING-NOTES.md) — `S$` is unreachable, `$` is
what renders — as a comment, not a workaround.

**Steps.**
1. `money.ts` + tests: JPY renders no decimals; GBP two; a 3-exponent currency
   three; a value larger than `Number.MAX_SAFE_INTEGER` survives (it arrives as
   a string and must be formatted as one).
2. `Breakdown.tsx` + tests: bands render; a non-applied component is labelled;
   total matches.
3. Wire `App.tsx`: quote on submit, render breakdown, surface 4xx bodies as
   readable messages rather than a blank page.

**Verification.** In the browser, reproduce the England cliff and the two
California counties, and confirm the numbers match the CLI exactly.

---

## Task 8: Guards, docs, CI

**Requirements.** The new packages are held to the same invariants as the old.

**Steps.**
1. `packages/api/tests/guards/no-jurisdiction-branch.test.ts` — greps
   `packages/api/src` **and** `packages/web/src` for all six pack ids. Must find
   nothing. Read files defensively at collection time (Plan 1's ENOENT trap:
   an unguarded read fails the whole file before any assertion exists).
2. Extend CI to typecheck and test every workspace, and to build `web`.
3. `docs/ARCHITECTURE.md` — add the HTTP and client layers to the boundary map.
4. `README.md` — the running app, with the two-command quickstart.
5. Update `docs/HANDOVER.md`: Plan 3 done, M3's form metadata partially
   delivered, Plan 2 still next.

**Verification.**
```bash
npm run typecheck && npm run lint && npm test
npm run build --workspace @registry/web
git diff --name-only HEAD -- packages/domain/src   # MUST be empty
```

That last command is the plan's headline check: an HTTP API and a React client
were added, and the domain did not move.

---

## Definition of done

- [ ] `npm test` green across all workspaces; domain still 360.
- [ ] `npm run typecheck`, `npm run lint` silent.
- [ ] `npm run build --workspace @registry/web` succeeds.
- [ ] `git diff packages/domain/src` empty for the whole plan.
- [ ] All six jurisdictions quote correctly in the browser, matching the CLI.
- [ ] Every response carries its provenance disclaimer; the UI shows it.
- [ ] No pack id appears in `packages/api/src` or `packages/web/src`.
- [ ] Money never crosses a boundary as a JSON number, in either direction.
- [ ] CI green on the PR.

## Self-review

Three things to check honestly at the end.

1. **Did the domain really not change?** If it did, say which file and why,
   rather than quietly folding it into a commit.
2. **Is the form actually pack-driven, or is it pack-driven for five packs and
   special-cased for the sixth?** `US-CA`'s county sub-schedule is where this
   would break first.
3. **Does the England cliff show the same numbers in the browser, the CLI and
   the golden fixtures?** Three surfaces over one engine; a disagreement means
   a mapping layer crept in somewhere.
