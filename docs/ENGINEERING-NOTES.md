# Engineering notes, roadmap and limitations

See [README](../README.md) for the overview.

## Roadmap

The domain layer is done. What follows is specified in
`docs/superpowers/specs/` and sequenced, not speculative.

| Plan | Scope | Status |
|---|---|---|
| **1** | Money, fee engine, six jurisdictions, pack loader, guards, CLI | ✅ **Complete** — 360 tests |
| 2 | HTTP layer: quote endpoint, pack-driven form metadata, Zod validation, correlation ids | Specified |
| 3 | Persistence and lifecycle: Prisma schema, application state machine, append-only ledger, auth | Specified |
| 4 | Gateway integration: `PaymentProvider` port, Stripe and Razorpay adapters, hosted checkout, signature-verified webhooks, routing config | Specified |
| 5 | Correctness hardening: webhook idempotency, out-of-order tolerance, reconciliation job, refunds | Specified |
| 6 | Clerk and admin console, receipt PDF, E2E suite | Specified |

Plans 2–6 are deliberately unwritten in detail: their interfaces should be
authored against signatures that have actually run, not signatures that were
imagined.

### Design decisions already taken for later plans

- **Two gateways, hard-capped.** Stripe primary (multi-currency); Razorpay routed
  for India, because Razorpay cannot charge GBP, JPY, AED or USD at all — and
  that capability check runs at boot, not at checkout.
- **Provider vocabulary stops at the adapter boundary.** Stripe says
  `payment_intent.succeeded`, Razorpay says `payment.captured`; both normalise to
  one canonical event language. A grep for a provider name outside `adapters/` is
  a CI failure.
- **One writer for payment state.** The webhook handler and the reconciler call
  the same `applyPaymentEvent`. Two code paths mutating money state is the bug
  this design exists to prevent.
- **No queue, no outbox** — deliberately. Notifications are out of scope and
  receipts render on demand, so the webhook handler has no slow side-effect to
  defer. Adding an outbox with nothing to put in it would be architecture for its
  own sake.

### Explicitly out of scope

Real land-registry integration · real KYC or e-signature · production auth
(SSO/MFA) · notifications · FX conversion · tax remittance · PCI-scope card
handling (checkout is gateway-hosted, card data never reaches these servers) ·
multi-tenancy · mobile apps · **legally authoritative fee rates**.

---

## Engineering notes

Four toolchain behaviours found by running the build rather than trusting it.
Recorded because each cost real time and none is documented obviously:

**`tsc` can exit 0 over output that cannot be imported.**
`rewriteRelativeImportExtensions` rewrites `import ... from './x.ts'` to `.js`
but leaves `export ... from './x.ts'` untouched. Every barrel file emitted a dead
`.ts` specifier while the compiler reported success and 71 tests passed. Nothing
consumes the emitted JS here — `exports` points at source — so this project
type-checks instead of emitting, and `tsconfig.base.json` records the trap.

**Node's type stripping rejects constructor parameter properties.**
`constructor(readonly x: string) {}` fails with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` under `--experimental-strip-types`, which the
CLI depends on. `erasableSyntaxOnly: true` now turns that runtime failure into a
compile error.

**Type-check your tests.** `typecheck` covers `tests/` as well as `src/`. It
immediately caught `currency = 'INR' as const` in a test helper — which narrows
the *parameter type* to that one literal, so passing `'JPY'` cannot compile.
Vitest strips types and had been running it happily.

**`Intl` behaviour must be measured, not assumed.** `ja-JP` renders JPY with the
fullwidth `￥` (U+FFE5); `ar-KW` renders Arabic-Indic digits (`١٫٢٣٤`); and no
locale or `currencyDisplay` value produces `S$` for SGD — all twelve
combinations were checked. `Intl.NumberFormat.format` does accept an exact
decimal *string* and preserves precision above 2⁵³, which is why `formatMoney`
needs no bigint branch.

### Known limitations

- **SGD renders as `$`, the same symbol as USD.** No locale or `currencyDisplay`
  value yields `S$` (measured). Each breakdown's header names its currency, so a
  single breakdown is unambiguous; the UI will need a deliberate choice where
  rows sit closer together.
- **Band slices are rounded individually, then summed** — not summed and rounded
  once. This is observable when two slices each land on a half unit. It is
  pinned by the golden fixtures, so a future change to the band walk fails
  loudly.
- **Tiering is not implemented.** All six packs load; which of them a citizen can
  pay through is a routing concern that arrives with the provider adapters in
  plan 4.

---

## License

Proof of concept. Not for production use, and not a fee calculator for any
jurisdiction.
