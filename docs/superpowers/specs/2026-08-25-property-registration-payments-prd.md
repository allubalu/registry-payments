# PRD — Property Registration Payment Service (POC)

**Status:** Draft for review
**Author:** Prasanna Allu
**Date:** 2026-08-25
**Scope:** Personal portfolio project — contains no proprietary or employer information
**Type:** Product Requirements Document (pre-implementation)

> This document is a PRD, not yet an implementation plan. On approval it
> feeds the `writing-plans` skill to produce the task-level plan.

---

## 1. Context

### 1.1 Problem

Registering a property transfer requires the buyer to pay statutory transfer
taxes and fees before the deed can be recorded — **stamp duty** in India, the
UK, and Australia; **transfer tax / recording fees** in the US;
**notary and land-registry fees** in Germany and France. Every jurisdiction
levies a different set of components on a differently-defined chargeable value,
in its own currency. In a digital flow this payment is unusual compared to
ordinary e-commerce:

- It is a **single large payment** (tens of thousands to millions in minor
  units). A double-charge is not a support ticket — it is a legal and financial
  incident.
- The payment receipt is **legal evidence** used at deed registration. It must
  be immutable and reproducible years later.
- Payment success does **not** mean registration success. The sub-registrar can
  still reject the deed, which triggers a refund against an already-settled
  payment.
- The citizen's browser is an unreliable narrator. They close the tab, lose
  network, or hit back mid-UPI-collect. The gateway webhook is the only
  trustworthy signal.

Most payment integrations ignore all four and treat the redirect as truth.

### 1.2 Why build this

This is a **proof of concept**, built to:

1. Prove a correct, auditable payment integration pattern — exactly-once money
   handling, webhook-as-source-of-truth, reconciliation, immutable ledger —
   against a **real gateway in sandbox mode** (Razorpay test), not a mock.
2. Serve as a reference implementation and portfolio artifact demonstrating
   senior-level payment engineering in a real-estate domain.

### 1.3 Intended outcome

A running local full-stack application where a citizen picks a jurisdiction,
files a property registration, pays real sandbox money **in that
jurisdiction's own currency through the gateway routed for that market**, and
receives a verifiable receipt; where a clerk can approve or reject and issue a
refund — with every money transition captured in an append-only ledger and a
reconciliation job that self-heals missed webhooks.

The pluggability is the point: **adding a country must be a config file, not a
code change**, and **adding a gateway must be one adapter, with no change to
domain or service code**.

### 1.4 Non-goals

Explicitly out of scope for this POC:

- Real land-registry / government API integration in any jurisdiction. No live
  filing.
- Real KYC, identity verification, or e-signature.
- Production auth. Local email + password with JWT and seeded users only — no
  Entra ID / OAuth / SSO, no password reset, no MFA, no email verification.
- Notifications of any kind. No email, SMS, or push; consequently no queue and
  no outbox (see §6).
- **Legally authoritative fee rates.** The engine is jurisdiction-pluggable and
  the shipped rule packs are demonstration data. This is not a tax calculator.
- **FX conversion.** Each application is priced and charged in its
  jurisdiction's own currency. No cross-currency settlement, no rate feeds, no
  multi-currency accounts.
- Tax remittance, filing, or reporting to any authority.
- PCI-scope card handling. Card data never touches our servers — checkout is
  gateway-hosted.
- Multi-tenancy, horizontal scale, HA, or load testing.
- Mobile apps.

---

## 2. Users and roles

| Role | Who | Needs |
|---|---|---|
| **Citizen** | Property buyer | File a registration, see the fee and how it was computed, pay, get a receipt, track status |
| **Clerk** | Sub-registrar office staff | Review filed registrations with confirmed payment, approve or reject, initiate refund on rejection |
| **Admin** | Platform operator | See all payments, inspect webhook and ledger history, view reconciliation mismatches, force a reconcile |

Roles are enforced server-side on every endpoint. Client-side role checks are
UX only, never the boundary.

---

## 3. User stories

### Citizen

- **C0** — I select my **jurisdiction** first; the form then asks only the
  fields that jurisdiction actually needs, and all amounts show in its currency.
- **C1** — I enter property details (market value, consideration, property type,
  transaction type, plus jurisdiction-specific attributes) and see the computed
  fee **broken down by component with the rule applied to each** before paying.
- **C2** — I submit the registration and get an application with a reference
  number in `PENDING_PAYMENT`.
- **C3** — I pay through the hosted checkout for my market, using whichever
  methods that market offers (UPI/netbanking in India, cards and local methods
  elsewhere).
- **C4** — If I close the browser mid-payment, when I return the application
  shows the true current state, resolved from the gateway — not a stale
  "pending".
- **C5** — On confirmed payment I can download a receipt PDF carrying the
  reference number, amount breakdown, gateway payment id, and timestamp.
- **C6** — If I retry a payment on an application that is already paid, I am
  **not** charged again.
- **C7** — I can see application status: `PENDING_PAYMENT` → `PAID` →
  `UNDER_REVIEW` → `REGISTERED` or `REJECTED` → `REFUNDED`.

### Clerk

- **K1** — I see a queue of applications with confirmed payment awaiting review.
- **K2** — I open one, see the fee breakdown and payment proof, and approve it —
  moving it to `REGISTERED`.
- **K3** — I reject one with a mandatory reason, moving it to `REJECTED` and
  flagging it as refund-eligible.
- **K4** — I initiate a refund on a rejected application. I cannot refund an
  approved one, an unpaid one, or one already refunded.

### Admin

- **A1** — I list and filter all payments by status, date, and amount.
- **A2** — I open a payment and see its full **event timeline**: order created,
  each webhook received (with signature verification result), each state
  transition, each ledger entry.
- **A3** — I see a **reconciliation dashboard** of payments whose local state
  disagrees with the gateway, or that have been `PENDING` beyond a threshold.
- **A4** — I trigger reconciliation for one payment or for all stale ones, and
  see what changed.
- **A5** — I can replay a stored webhook payload against the handler to prove
  idempotency (dev tool, non-prod only).

---

## 3A. User journey

Plain-language walkthrough for anyone — engineer or not — to understand what
this product does. All amounts below are **illustrative synthetic figures**, not
real fee rates.

### 3A.1 The whole journey at a glance

```
  CITIZEN                     SYSTEM                    CLERK / ADMIN
  ───────                     ──────                    ─────────────
  1 pick jurisdiction  ──▶  loads rule pack
                              (currency, fields)
  2 enter property     ──▶  computes fee breakdown
                       ◀──  shows itemised quote
  3 confirm            ──▶  creates application
                       ◀──  reference REG-2026-0041
                              status PENDING_PAYMENT
  4 pay                ──▶  routes to gateway
                              (Stripe / Razorpay)
                            hosted checkout
                       ┌─── gateway charges card/UPI
                       │
                       ▼
                     WEBHOOK ──▶ verify signature
                                 apply CAPTURED
                                 write ledger entry
                       ◀──  status PAID
  5 download receipt   ◀──  PDF from stored data
                                                  ──▶  6 sees it in queue
                                                       7 approves ──▶ REGISTERED
                                                          or rejects ──▶ REJECTED
                                                       8 refunds if rejected
                       ◀──  REFUNDED, ledger nets to 0
```

### 3A.2 Journey A — happy path (Priya, Hyderabad)

**Step 1 — Choose where.** Priya opens the portal and picks
**India → Telangana**. The page immediately switches to **₹** and shows an
amber banner: *"Illustrative rates for demonstration only."* The form now asks
Telangana's questions — market value, transaction type, property type. It does
not ask about first-time-buyer status, because Telangana's rule pack doesn't
declare that field.

**Step 2 — See the number, and why.** She enters a market value of ₹50,00,000
and a consideration of ₹48,00,000. The quote appears instantly:

| Component | Basis | Rate | Amount |
|---|---|---|---|
| Stamp Duty | ₹50,00,000 | 4.0% | ₹2,00,000 |
| Transfer Duty | ₹50,00,000 | 1.5% | ₹75,000 |
| Registration Fee | ₹50,00,000 | 0.5% | ₹25,000 |
| User Charges | — | flat | ₹200 |
| **Total** | | | **₹3,00,200** |

*Chargeable value: ₹50,00,000 — the higher of market value and consideration.*

The **"why" is on screen**, not hidden. She can see the basis rule, each rate,
and that the higher of the two values was used. Nothing to phone a helpdesk
about.

**Step 3 — File it.** She confirms. She gets reference **REG-2026-0041**,
status **Awaiting payment**, valid for 30 minutes.

**Step 4 — Pay.** She clicks Pay. Because the jurisdiction is `IN-TG`, the
system routes her to **Razorpay**, so she sees **UPI, netbanking and cards** —
the methods that actually matter in India. She pays ₹3,00,200 by UPI.

**Step 5 — Confirmation that is actually true.** Her browser returns to the
portal showing "Confirming your payment…". A second later it flips to **Paid**.
Behind the scenes what changed her status was **not** the browser returning —
it was a signed webhook from Razorpay. The browser only asked; the gateway
answered.

**Step 6 — Receipt.** She downloads a PDF: reference, her name, the full fee
breakdown with the rule version used, the total, the gateway payment id, the
timestamp, and the demonstration disclaimer. Amounts print as **₹3,00,200.00**
in Indian grouping.

**Step 7 — Review.** Ravi, a clerk, sees REG-2026-0041 in his queue with
payment confirmed. He opens it, checks the details, clicks **Approve**. Status
becomes **Registered**. Priya sees it on her dashboard.

### 3A.3 Journey B — she closes the tab mid-payment

The realistic case, and the one most integrations get wrong.

Priya's phone dies during the UPI approval. She never sees a confirmation page.

- She logs back in an hour later. Her application shows **Paid**, not "pending"
  and not "failed" — because the webhook arrived and updated the record while
  her phone was off. The truth never depended on her browser.
- **If the webhook had also been lost** (network blip at the gateway), the
  reconciliation job would have noticed a payment stuck in a non-final state,
  asked the gateway directly what happened, and corrected the record — within
  about five minutes, with no human involved.
- If she had instead clicked **Pay** a second time on an application already
  paid, she would **not** be charged twice. The system refuses to create a
  second successful payment for one application, enforced by a database
  constraint, not just a check in code.

**The point of this journey:** the citizen is never the one who has to notice
something went wrong.

### 3A.4 Journey C — rejected, then refunded (James, England)

**Different country, different everything.** James picks **United Kingdom →
England**. The currency becomes **£**, and the form now asks a question Priya
never saw: *"Is this your first property purchase?"* — because the `GB-ENG`
rule pack declares that field.

His fee is calculated with **progressive bands** — a different mathematical
model from Priya's flat percentages. Each band is charged marginally, and the
breakdown shows every band, its bound, its rate, and its slice of the total.
**No code was changed to support England.** It is one configuration file.

He pays £6,500 by card — routed to **Stripe** this time, not Razorpay, because
Razorpay cannot charge pounds.

Then it goes wrong: Ravi reviews the filing and finds the title documents don't
match. He clicks **Reject** and must type a reason — the field is mandatory.
Status becomes **Rejected**, flagged refund-eligible.

Ravi clicks **Refund**. The refund goes back **in pounds, through Stripe** — the
same currency and same gateway that took the money. It could not have gone back
in rupees or through Razorpay; the system makes that impossible rather than
merely discouraged. When Stripe confirms, status becomes **Refunded** and the
application's money position nets to **exactly zero**.

James gets his money back. The record of what happened stays permanently — the
ledger is never erased, only added to.

### 3A.5 Journey D — the operator's view (Anita, admin)

Anita never touches a citizen's payment. She watches the machinery.

**She opens a payment and sees one timeline** — not four screens:

```
14:02:11  Order created            Stripe    £6,500.00
14:02:48  Webhook received         payment_intent.succeeded  ✅ signature valid
14:02:48  State change             CREATED → CAPTURED
14:02:48  Ledger entry             +£6,500.00   source: WEBHOOK
14:19:03  Reconciliation checked    no change needed
15:40:22  Refund initiated         by ravi@clerk   idempotency key ab3f…
15:40:55  Webhook received         charge.refunded           ✅ signature valid
15:40:55  Ledger entry             −£6,500.00   source: WEBHOOK
                                   ─────────────────────────
                                   net £0.00 ✓
```

**Her reconciliation dashboard** answers one question: is anything stuck?
Stale payments per gateway, unresolved mismatches, last check time. If the
gateway says a payment was captured for an amount that doesn't match ours, the
system **refuses to auto-correct it** — it raises it for a human. Silently
"fixing" a money discrepancy is worse than flagging it.

**Her jurisdiction registry** lists all six loaded packs — id, currency,
version, `SYNTHETIC` badge, and which gateway each routes to. Six countries'
worth of fee rules, visible as data.

**And she can prove idempotency on demand.** In the demo environment she can
replay a stored webhook. It runs, the log says "duplicate, ignored", and the
status and ledger **do not move**. That's the guarantee made visible instead of
asserted.

### 3A.6 What each journey is designed to prove

| Journey | Demonstrates |
|---|---|
| A — happy path | Transparent fee computation, jurisdiction-driven forms, market-appropriate payment methods, verifiable receipt |
| B — abandoned tab | Webhook-as-truth, self-healing reconciliation, double-charge impossible |
| C — reject and refund | Structurally different fee model with zero code change, currency and gateway integrity on refund, ledger nets to zero |
| D — operator view | Full auditability, no silent corrections, pluggability visible, idempotency provable live |

---

## 4. Functional requirements

### 4.0 Money and currency

**FR-0a — Money is a value object, never a number.** `Money { amountMinor:
bigint, currency: CurrencyCode }`. There is no bare numeric money type in the
codebase. Arithmetic on two `Money` values of **different currencies throws** —
mixing currencies is a type/runtime error, not a silent bug.

**FR-0b — Minor units are per-currency, not assumed to be 2.** The currency
registry carries each currency's ISO 4217 `minorUnitExponent`: `USD`/`EUR`/`INR`
= 2, `JPY` = 0, `KWD`/`BHD` = 3. Formatting, parsing, and rounding all read the
exponent. Hardcoding "divide by 100" anywhere is a defect.

**FR-0c — Gateway minor-unit contract.** Both Stripe and Razorpay take amounts
in the currency's smallest unit, so `amountMinor` passes through unconverted.
Zero-decimal currencies (JPY) are the case that breaks naive code; a test
covers each exponent class (0, 2, 3).

**FR-0d — Display formatting is presentation-only.** The server sends
`{ amountMinor: "1250000", currency: "JPY" }` as a **string** (JSON has no
BigInt). The client formats with `Intl.NumberFormat` using the user's locale.
The server never sends a formatted string as data, and the client never does
arithmetic.

**FR-0e — One currency per application, fixed at creation.** Derived from the
jurisdiction, persisted on the application, and immutable. Payment and refund
inherit it. No FX anywhere.

### 4.1 Fee calculation engine (jurisdiction-pluggable)

**FR-1** — Fee computation is a **pure function**:
`computeFee(input: FeeInput, pack: JurisdictionRulePack) => FeeBreakdown`. No
I/O, no clock, no randomness, no jurisdiction-specific branching in the engine
itself. Fully unit-testable.

**FR-2** — `FeeInput` is jurisdiction-neutral: jurisdiction id, property type
(`LAND | HOUSE | APARTMENT | COMMERCIAL`), transaction type
(`SALE | GIFT | MORTGAGE | LEASE`), declared consideration as `Money`, assessed
market value as `Money`, and an open `attributes: Record<string, string |
number | boolean>` map for jurisdiction-specific inputs (first-time buyer,
resident status, buyer count, property age). The rule pack declares which
attributes it requires; validation is driven from that declaration, so adding a
jurisdiction needs **no engine change**.

**FR-3 — Chargeable value is a rule-pack decision, not a hardcoded rule.**
Jurisdictions differ genuinely: India charges on `max(market, consideration)`,
the UK on consideration paid, several US states on consideration with local
minimums. The pack names its basis strategy (`MAX_OF_MARKET_AND_CONSIDERATION |
CONSIDERATION_ONLY | MARKET_ONLY`) and the engine applies the named strategy.

**FR-4 — Component model covers the three real shapes.** Every jurisdiction's
fees decompose into components, each being one of:

- `FLAT` — fixed amount (recording fee, notary base)
- `PROPORTIONAL` — `ratePpm` applied to a basis
- `PROGRESSIVE_BANDS` — ordered bands, each with an upper bound and a rate,
  charged marginally (UK SDLT, most income-tax-style schedules)

Plus optional per-component `minAmount`, `maxAmount`, and a `condition`
expression over `attributes` (e.g. first-time-buyer relief applies only below a
threshold).

**FR-5** — `FeeBreakdown` is fully self-explaining — a citizen must be able to
see exactly how the number was reached:

```
{
  jurisdictionId: 'IN-TG',
  currency: 'INR',
  chargeableValue:  { amountMinor: '500000000', currency: 'INR' },
  basisStrategy: 'MAX_OF_MARKET_AND_CONSIDERATION',
  components: [
    { code: 'STAMP_DUTY', label: 'Stamp Duty', kind: 'PROPORTIONAL',
      basis: {...}, ratePpm: 40000, amount: {...}, appliedRules: [...] },
    { code: 'REGISTRATION_FEE', kind: 'PROGRESSIVE_BANDS',
      bands: [...], amount: {...}, appliedRules: [...] },
    { code: 'RECORDING_FEE', kind: 'FLAT', amount: {...} }
  ],
  total: { amountMinor: '...', currency: 'INR' },
  packId: 'IN-TG', packVersion: '2026.1',
  packSource: '<citation url>', packRetrievedAt: '<iso date>',
  disclaimer: 'Demonstration computation. Not an official assessment.'
}
```

**FR-6** — Rates are **integer parts-per-million (`ratePpm`)**, never
floating-point percentages. `0.5%` = `5000` ppm. `4%` = `40000` ppm.

**FR-7** — Rounding is explicit, per-component, and **specified by the rule
pack** (`HALF_UP | HALF_EVEN | CEIL | FLOOR`) to the currency's minor unit or to
a coarser step the pack names (some jurisdictions round duty up to the nearest
whole currency unit). Components are rounded individually **then** summed; never
summed then rounded. Every rounding step appears in `appliedRules`.

**FR-8 — Rule packs are versioned data, not code.** One file per jurisdiction
at `config/jurisdictions/<id>-<version>.json`, Zod-validated at boot. `id` is
ISO 3166 based — `IN-TG`, `GB-ENG`, `US-CA`, `AE-DU`, `SG`, `AU-NSW`. Each
application persists `packId` + `packVersion`, so a historical fee is
reproducible after rates change.

**FR-9 — Adding a jurisdiction must require zero engine code.** This is the
acceptance test for the abstraction: a new pack file plus a fixture-driven test
case is the entire change. CI asserts it — the jurisdiction test suite is
generated by globbing the pack directory.

**FR-10 — Sourcing constraint (blocking, applies to every pack).** The POC must
**not** ship invented rates presented as real. Two lanes, and a pack must
declare which it is:

- `"provenance": "SOURCED"` — requires non-null `packSource` (citation URL) and
  `packRetrievedAt`. Boot **throws** if either is missing.
- `"provenance": "SYNTHETIC"` — rates are illustrative. The pack's
  `jurisdictionLabel` is suffixed `(synthetic)`, every API response carries
  `provenance: 'SYNTHETIC'`, and the UI shows a persistent amber banner:
  *"Illustrative rates for demonstration only — not this jurisdiction's actual
  fees."*

There is no third state. A pack with unmarked or unsourced rates fails boot.

**FR-11 — Ship six packs spanning structurally different fee models**, so the
abstraction is proven by breadth rather than asserted. All six are `SYNTHETIC`
(FR-10), so each costs one JSON file plus fixtures and **zero engine code** —
which is precisely the claim being tested.

| Pack | Currency (exp) | Exercises |
|---|---|---|
| `IN-TG` | INR (2) | Proportional duty on `max(market, consideration)`, flat user charges, lakh/crore grouping |
| `GB-ENG` | GBP (2) | **Progressive marginal bands**, first-time-buyer relief with a threshold condition |
| `JP` | JPY (**0**) | **Zero-decimal currency**, flat + proportional mix |
| `AE-DU` | AED (2) | Flat-percentage transfer fee, `CONSIDERATION_ONLY` basis |
| `US-CA` | USD (2) | County-level flat recording fees **plus** proportional transfer tax, per-component minimums |
| `SG` | SGD (2) | **Two stacked band schedules** (base duty + additional duty), residency attribute driving the second |

**FR-11a — Tiered rollout, to keep scope bounded.** Two tiers:

- **Wired tier (5 packs — `IN-TG`, `GB-ENG`, `JP`, `AE-DU`, `US-CA`):** full
  path — citizen UI, provider routing, real sandbox payment, receipt, E2E test.
  Between them they cover exponent 0 and 2, and all four fee shapes the engine
  claims to support: proportional on a derived basis (`IN-TG`), progressive
  marginal bands with a conditional relief (`GB-ENG`), flat plus proportional in
  a zero-decimal currency (`JP`), a single flat percentage on consideration only
  (`AE-DU`), and stacked proportional taxes over per-document flat fees with a
  component minimum and cap (`US-CA`).
- **Fixture tier (1 pack — `SG`):** loaded by the registry, visible in
  `GET /api/jurisdictions` and the admin registry view, validated at boot, and
  covered by golden-file unit tests — **but not part of the E2E suite.** It
  holds the tier open so the live/loaded distinction stays real and provable,
  and its two-stacked-band-schedules model is the hardest fee shape to reach
  through a UI.

**FR-11b — `AE-DU` and `US-CA` are payable in the UI.** Both appear as
selectable jurisdictions on the citizen picker, quote with a full itemised
breakdown, route to Stripe, take a real sandbox payment, and produce a receipt
in their own currency. `US-CA` additionally exposes a **county attribute** that
selects a sub-schedule *inside* the same pack — proving that sub-jurisdictional
variation is data too, and does not require one pack per county. `AE-DU`
exposes a **mortgage attribute** that conditionally adds a component.

Promotion from fixture to wired tier is config only. Any pack failing to load,
in either tier, fails boot.

**FR-12** — Fee quote endpoint is idempotent and side-effect free. Quoting does
not create an application. `GET /api/jurisdictions` lists available packs with
their required attributes and provenance, so the client form is **driven by the
pack**, not hardcoded per country.

### 4.2 Application lifecycle

**APP-1** — Application state machine. Transitions are the **only** way state
changes; each is validated against an explicit allow-list.

```
                    ┌──────────────────┐
                    │ PENDING_PAYMENT  │ ◀── created
                    └────────┬─────────┘
                             │ payment CAPTURED (webhook)
                             ▼
                        ┌────────┐
                        │  PAID  │
                        └───┬────┘
                            │ clerk opens
                            ▼
                    ┌──────────────┐
                    │ UNDER_REVIEW │
                    └──┬────────┬──┘
                approve│        │reject (reason required)
                       ▼        ▼
              ┌────────────┐  ┌──────────┐
              │ REGISTERED │  │ REJECTED │
              └────────────┘  └────┬─────┘
                  (terminal)       │ admin/clerk refunds
                                   ▼
                            ┌──────────────┐
                            │ REFUND_       │
                            │ INITIATED     │
                            └──────┬───────┘
                                   │ refund.processed webhook
                                   ▼
                             ┌──────────┐
                             │ REFUNDED │ (terminal)
                             └──────────┘

  PENDING_PAYMENT ──expiry (TTL)──▶ EXPIRED (terminal)
```

**APP-2** — Illegal transitions are rejected with `409 Conflict` and a machine-
readable `code`, never silently ignored.

**APP-3** — `PENDING_PAYMENT` applications expire after a configurable TTL
(default 30 min). Expiry is a state transition, not a delete.

**APP-4** — Jurisdiction and currency are fixed at creation and immutable. To
change jurisdiction the citizen files a new application.

### 4.3 Payment state machine

**PAY-1** — Payment states: `CREATED` → `AUTHORIZED` → `CAPTURED`, plus
`FAILED`, `EXPIRED`; and from `CAPTURED`: `REFUND_PENDING` →
`REFUNDED` / `PARTIALLY_REFUNDED`.

**PAY-2** — A payment's amount **and currency** are **immutable after
creation**. Changing a fee requires a new payment attempt, not an edit.

**PAY-3** — An application may have **many payment attempts** but **at most one
in a successful state**. Enforced by a partial unique index —
`UNIQUE(applicationId) WHERE status IN ('AUTHORIZED','CAPTURED')` — so
correctness does not rely on application code alone.

**PAY-4 — Amount and currency are recomputed server-side** from the persisted
fee breakdown at order-creation time and compared to the persisted total. A
client-supplied amount or currency is never trusted, and a mismatch aborts.

**PAY-5** — The **provider is chosen from the application's jurisdiction** by a
routing rule (§4.4), persisted on the payment row, and immutable thereafter. A
payment is always reconciled and refunded through the provider that created it.

### 4.4 Gateway integration (multi-provider)

Going international forces a second provider: **Razorpay is India-only** and
cannot charge GBP, JPY, or AED. See the open decision in §11.1.

**GW-1 — One port, several adapters.** `PaymentProvider` interface:

```ts
interface PaymentProvider {
  readonly id: ProviderId                    // 'stripe' | 'razorpay' | 'fake'
  readonly supportedCurrencies: Set<CurrencyCode>
  createOrder(cmd: CreateOrderCmd): Promise<ProviderOrder>
  fetchPaymentState(ref: ProviderRef): Promise<CanonicalPaymentState>
  initiateRefund(cmd: RefundCmd): Promise<ProviderRefund>
  verifyWebhookSignature(rawBody: Buffer, headers: Headers): SignatureResult
  parseWebhook(rawBody: Buffer): CanonicalPaymentEvent
}
```

**GW-2 — Provider-specific vocabulary stops at the adapter boundary.** Stripe
says `PaymentIntent` / `payment_intent.succeeded`; Razorpay says `Order` /
`payment.captured`. Both `parseWebhook` implementations return the same
`CanonicalPaymentEvent` (`AUTHORIZED | CAPTURED | FAILED | REFUNDED |
REFUND_FAILED | UNKNOWN`). **No domain or service code may reference a provider
name or a provider event string.** A grep for `stripe`/`razorpay` outside
`adapters/` is a CI failure.

**GW-3 — Routing is config, not code.** `config/provider-routing.json` maps
jurisdiction → provider with a default fallback. Unroutable jurisdiction fails
fast at boot, not at checkout. Routing decision is persisted on the payment.

**GW-4 — Currency capability is validated at boot.** Every configured
jurisdiction's currency must be in its routed provider's
`supportedCurrencies`. A pack charging JPY routed to Razorpay fails boot with a
clear message — not at 3am in production.

**GW-5** — Credentials (`publishableKey`/`key_id`, secret key, webhook secret)
come from environment variables only, namespaced per provider. Never committed.
Only the publishable/`key_id` value is sent to the client — public by design.

**GW-6 — Checkout is gateway-hosted for every provider** (Stripe Checkout
Session or Payment Element; Razorpay Standard Checkout). No PAN, CVV, or UPI
credential ever reaches our servers or logs. Keeps the POC out of PCI-DSS
scope.

**GW-7 — Webhook signature verification is mandatory and per-provider.** Each
adapter implements its own scheme, both HMAC-SHA256 but framed differently:

- **Stripe** — `Stripe-Signature` header carries `t=<timestamp>,v1=<sig>`; the
  signed payload is `"{t}.{rawBody}"`, and the **timestamp must be checked
  against a tolerance window (default 300s)** to reject replays.
- **Razorpay** — `X-Razorpay-Signature` is the HMAC of the raw body alone, with
  no timestamp. Replay protection therefore rests entirely on event-id
  idempotency (GW-10), which is why that constraint is not optional.

**GW-8 — Comparison is constant-time, over raw body bytes.** Each webhook route
mounts a raw-body parser **before** any JSON parser. A JSON parse-and-
re-serialize changes the bytes and breaks every signature — the single most
common integration bug in this area.

**GW-9** — Failed verification → `400`, payload stored with `signatureValid:
false`, **no state change**, flagged in the admin console.

**GW-10 — Webhook idempotency, keyed on the provider's event id** under a
`UNIQUE(provider, providerEventId)` constraint. A duplicate delivery is
detected, logged, and returns `200` **without re-applying** any state change or
ledger entry. Both providers retry; duplicates are normal, not exceptional.

**GW-11 — Unknown event types** are stored, mapped to `UNKNOWN`, and
acknowledged `200`. Never error — an unrecognised event must not cause endless
provider retries or a disabled endpoint.

**GW-12 — Out-of-order tolerance.** Events can arrive out of order (`captured`
before `authorized`). The handler applies a transition only if legal from the
current state; a backwards event is a no-op-with-log, not an error and not a
regression.

**GW-13 — Webhook handling is transactional**: store event, apply transition,
write ledger entry — one DB transaction. A crash mid-handler leaves no partial
state.

**GW-14 — Webhook handling does no slow work at all.** No notifications, no PDF
generation, no outbound calls inside the handler. Receipts are rendered on
demand (RCP-1), so there is nothing to pre-generate. The handler is DB writes
only, which is what keeps it inside the provider's timeout — and it is why this
POC needs no queue or outbox.

**GW-15 — The browser redirect is advisory only.** It may optimistically render
a result but must never be the basis for marking a payment captured. On landing
the client polls application status; the server answers from its own state,
reconciling with the provider if that state is stale.

**GW-16 — Payment-method surface differs by market** and is provider-declared,
not hardcoded: UPI and netbanking in India, cards and wallets broadly, SEPA
debit and iDEAL in Europe. The client renders whatever the provider's session
offers; our code makes no assumption about which methods exist.

### 4.5 Reconciliation

**REC-1** — A reconciliation job runs on an interval (default 5 min) and, for
every payment in a non-terminal state older than a threshold (default 10 min),
calls `fetchPaymentState` on **the provider recorded on that payment** and
converges local state to the returned canonical state.

**REC-2** — Reconciliation is **idempotent and safe to run concurrently** with
webhook processing. It uses the same transition-validation path as the webhook
handler — there is exactly one code path that can change payment state.

**REC-3** — Reconciliation is **provider-agnostic**: it iterates payments and
resolves the adapter per row. Adding a provider adds no reconciler code.

**REC-4** — Every run records payments examined, mismatches found, transitions
applied, per provider. Visible in the admin console.

**REC-5** — An **unresolvable mismatch** — provider reports captured for an
amount or currency differing from ours — is **never auto-corrected**. It is
flagged `NEEDS_MANUAL_REVIEW` and surfaced to admin. A currency mismatch is
treated as the most severe class.

### 4.6 Refunds

**REF-1** — Refund is initiated only from `REJECTED` on an application whose
payment is `CAPTURED`. Any other combination is rejected.

**REF-2** — Refund is in the **original payment currency**, through the
**original provider**, for an amount `<=` the captured amount. Cross-currency
refunds are impossible by construction (FR-0a).

**REF-3** — Refund requests carry a caller-supplied **idempotency key**, passed
through to the provider (Stripe `Idempotency-Key` header; Razorpay refund
idempotency), so a retried request cannot double-refund.

**REF-4** — Refund completion is confirmed by the refund webhook, not by the API
response to the initiate call.

**REF-5** — POC supports **full refunds only**. Partial refunds are modelled in
the schema (amount on the refund row) but not exposed in the UI.

### 4.7 Ledger and audit

**LED-1** — An **append-only ledger** records every money event. Rows are
`INSERT`-only; there is **no UPDATE or DELETE path** to a ledger row anywhere in
the codebase. Corrections are new compensating entries.

**LED-2** — Each entry carries: id, application ref, payment ref, entry type
(`FEE_ASSESSED | PAYMENT_CAPTURED | REFUND_ISSUED`), **signed `amountMinor`**,
**`currency`**, `minorUnitExponent` snapshot, provider + provider reference,
source of truth (`WEBHOOK | RECONCILIATION | MANUAL`), actor, `correlationId`,
`createdAt`.

**LED-3 — Balances are per (application, currency).** There is no global total
and no "all money" figure anywhere in the system or the admin UI, because
summing across currencies is meaningless without FX. Admin aggregates are
**grouped by currency** and displayed as separate lines, never summed.

**LED-4 — Invariant:** for any application,
`sum(ledger.amountMinor) GROUP BY currency` yields exactly one currency row, and
that sum equals the net position (`0` after full refund). Asserted after every
scenario in the automated suite.

**LED-5** — An audit log records every **non-money** privileged action: clerk
approve/reject with reason, admin forced reconcile, login. Actor, timestamp,
before/after state.

### 4.8 Receipt

**RCP-1** — Receipt PDF is generated **on demand from persisted data**, never
cached as the source of truth. Contains: application reference, payer name,
jurisdiction, property identifiers, itemised fee breakdown with `packId` +
`packVersion` + provenance, total, currency, provider payment id, captured
timestamp, and the demonstration-only disclaimer (amber-equivalent wording when
the pack is `SYNTHETIC`).

**RCP-2 — Amounts are formatted for the jurisdiction's locale and currency**
using its minor-unit exponent — `¥1,250,000` with no decimals, `₹5,00,000.00` in
the Indian grouping convention, `£250,000.00`. A receipt showing `¥1250000.00`
is a defect.

**RCP-3** — Receipt is downloadable only by the owning citizen, a clerk, or an
admin. Ownership is checked server-side; a guessable URL is not authorization.

### 4.9 Admin console

**ADM-1** — Payments list: filter by status, date range, **jurisdiction**,
**currency**, **provider**, and amount range. Paginated server-side. Amount
filtering requires a currency to be selected — an amount range across
currencies is rejected rather than silently misinterpreted.

**ADM-2** — Payment detail: unified chronological timeline merging state
transitions, webhook receipts (with signature-valid badge and provider name),
reconciliation runs, and ledger entries.

**ADM-3** — Reconciliation dashboard: stale-payment count **broken down by
provider**, mismatch list, last run time per provider, manual "reconcile now".

**ADM-4** — Jurisdiction registry view: loaded packs, versions, provenance
(`SOURCED` / `SYNTHETIC` badge), currency, routed provider, source citation.
Makes the pluggability visible rather than buried in config files.

**ADM-5** — Raw webhook payload viewer, secrets redacted, provider labelled.

**ADM-6** — Webhook replay tool, **disabled unless `NODE_ENV !== 'production'`**,
for demonstrating idempotency. Works for any provider.

---

### 4.10 Authentication

**AUTH-1** — Local email + password. Three seeded users, one per role
(`citizen`, `clerk`, `admin`), created by the seed script with credentials
printed to the console for demo convenience.

**AUTH-2** — Passwords hashed with **bcrypt** (cost ≥ 12) or argon2id. Never
logged, never returned by any endpoint, never compared with `==`.

**AUTH-3** — `POST /api/auth/login` issues a short-lived JWT (default 1h) signed
with an env-supplied secret, carrying `sub`, `role`, and `locale`. No refresh
tokens in the POC; re-login on expiry.

**AUTH-4** — Role comes **from the verified token**, never from a request body,
header, or query parameter. Every protected route resolves role server-side.

**AUTH-5 — Authorization is checked at two levels on every request:** role
(is a clerk allowed to call this?) and **resource ownership** (is this
citizen's application?). A valid token for the wrong user must not read another
citizen's application or receipt — this has an explicit test.

**AUTH-6** — Login attempts are rate-limited per email and per IP. Failed login
returns an identical generic error regardless of whether the email exists.

**AUTH-7** — Every login, logout, and failed attempt is written to the audit log
(LED-5) with actor, IP, and correlation id.

---

## 5. Non-functional requirements

| # | Requirement |
|---|---|
| **NFR-1** | **No money in floats, no bare money numbers.** Enforced by the `Money` value object plus a lint rule banning arithmetic operators on `amountMinor`. Money crosses the wire as `{ amountMinor: string, currency }`, never a JS `Number`. |
| **NFR-1a** | **No currency-blind money.** Every persisted money column has a paired currency column; every money DTO carries `currency`. A schema test asserts the pairing so a future migration cannot add a lone amount column. |
| **NFR-1b** | **i18n from the start.** UI strings externalised, `Intl.NumberFormat` / `Intl.DateTimeFormat` for all money and dates, no string concatenation to build sentences. Retrofitting i18n later is far more expensive than starting with it. |
| **NFR-2** | **Secrets only from env.** `.env` gitignored, `.env.example` committed with empty values. A boot-time check fails fast on any missing required var. |
| **NFR-3** | **No PII or secrets in logs.** Structured JSON logs with a redaction allow-list. Webhook bodies stored in DB, redacted in logs. |
| **NFR-4** | **Every request carries a correlation id**, propagated to the gateway call and into every log line and ledger entry. |
| **NFR-5** | **Rate limiting** on quote, order-create, and refund endpoints. |
| **NFR-6** | Server-side **input validation with Zod** on every endpoint. Reject unknown fields. |
| **NFR-7** | **Authorization checked server-side on every endpoint**, resource-ownership included. |
| **NFR-8** | Webhook endpoints are unauthenticated by necessity — signature verification **is** their authentication. One route per provider, each rate-limited and body-size-capped. |
| **NFR-8a** | **Timezone discipline.** All timestamps stored UTC; jurisdiction timezone stored on the pack and used for display and for any business-day logic. No server-local time anywhere. |
| **NFR-9** | DB access via a repository layer; **all multi-write operations in explicit transactions**. |
| **NFR-10** | Schema is Prisma-managed and portable — SQLite for POC, Postgres by connection-string change. No SQLite-only constructs. |
| **NFR-11** | Deterministic tests. Clock and gateway are injected, never called directly from domain code. |
| **NFR-12** | `docker compose up` or a single `pnpm dev` starts everything. README documents ngrok webhook setup end to end. |

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React + Vite + TS                                      │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Citizen flow  │  │ Clerk queue  │  │ Admin console│  │
│  └───────────────┘  └──────────────┘  └──────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │ REST + JWT
┌───────────────────────────▼─────────────────────────────┐
│  Express + TS                                           │
│  ── http layer: routes, Zod validation, authz ──         │
│  ── application services: use-cases, transactions ──     │
│  ── domain (pure): Money, fee engine, state machines,    │
│                    ledger, jurisdiction registry ──      │
│  ── ports: PaymentProvider, Clock, PdfRenderer ──        │
│  ── adapters: Stripe | Razorpay | Fake, Clock, Prisma ── │
└──────┬───────────────┬───────────────────┬──────────────┘
       │               │                   │
  ┌────▼─────┐  ┌──────▼──────┐  ┌─────────▼─────────┐
  │ SQLite   │  │ config/     │  │ Stripe (test)     │
  │ (Prisma) │  │ jurisdictions│ │ Razorpay (test)   │
  └──────────┘  │ + routing   │  └───────────────────┘
                └─────────────┘
```

**Key structural decisions**

1. **Domain layer has zero I/O.** `Money`, fee engine, and state machines are
   pure functions over plain data — the most-tested and fastest-tested part of
   the system.
2. **Two independent axes of pluggability, deliberately kept separate.**
   *Jurisdiction* (what is owed, in which currency) is data — a rule pack.
   *Provider* (how it is collected) is code — an adapter. They meet only in the
   routing config. Conflating them is the design mistake this structure avoids:
   otherwise every new country needs a code change.
3. **`PaymentProvider` port with three adapters** — Stripe, Razorpay, and a
   `FakeProvider` that backs integration tests without network and can be
   scripted to emit duplicate, out-of-order, and lost-webhook scenarios
   on demand.
4. **One writer for payment state.** Webhook handler and reconciler both call
   the same `applyPaymentEvent`. Two code paths mutating money state is the bug
   this design exists to prevent.
5. **Canonical event model.** Provider vocabulary is normalised at the adapter
   edge, so the domain sees one event language regardless of gateway (GW-2).
6. **No queue, no outbox, deliberately.** Notifications are out of scope and
   receipts render on demand, so the webhook handler has no slow side-effect to
   defer. Adding an outbox with nothing to put in it would be architecture for
   its own sake. If notifications are added later, that is when the outbox
   arrives — and the transactional handler (GW-13) is already the right place
   to hook it.

### 6.1 Data model (essentials)

```
Application    id, ref(unique), citizenId, status,
               jurisdictionId, currency,           -- immutable after create
               propertyJson, attributesJson,
               chargeableValueMinor, totalFeeMinor, feeBreakdownJson,
               packId, packVersion, packProvenance,
               rejectionReason, expiresAt, timestamps

Payment        id, applicationId, provider, providerOrderId(unique),
               providerPaymentId(unique, nullable),
               amountMinor, currency, status,
               idempotencyKey(unique), timestamps
               + partial unique index on (applicationId) where status in
                 ('AUTHORIZED','CAPTURED')

Refund         id, paymentId, provider, providerRefundId(unique),
               amountMinor, currency, status, reason,
               idempotencyKey(unique), initiatedBy, timestamps

WebhookEvent   id, provider, providerEventId, eventType, canonicalType,
               rawBody, signatureValid, signatureFailureReason,
               processedAt, processingResult, receivedAt
               + UNIQUE(provider, providerEventId)

LedgerEntry    id, applicationId, paymentId, entryType,
               amountMinor(signed), currency, minorUnitExponent,
               provider, providerRef, sourceOfTruth, actor,
               correlationId, createdAt
               -- append-only, INSERT only

AuditLog       id, actorId, actorRole, action, targetType, targetId,
               beforeJson, afterJson, correlationId, createdAt

ReconRun       id, provider, startedAt, finishedAt, examinedCount,
               mismatchCount, transitionsAppliedCount, notes

User           id, email(unique), passwordHash, role, displayName,
               locale, createdAt
```

### 6.2 API surface

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | Email + password → JWT (rate-limited) |
| GET | `/api/auth/me` | any | Current user, role, locale |
| GET | `/api/jurisdictions` | public | Loaded packs: id, label, currency, provenance, required attributes |
| POST | `/api/fees/quote` | citizen | Fee breakdown for a jurisdiction, no side effects |
| POST | `/api/applications` | citizen | Create application, `PENDING_PAYMENT` |
| GET | `/api/applications/:ref` | owner/clerk/admin | Status + breakdown |
| POST | `/api/applications/:ref/payments` | citizen | Create provider order/intent, provider chosen by routing (idempotent) |
| GET | `/api/applications/:ref/receipt` | owner/clerk/admin | Receipt PDF |
| POST | `/api/webhooks/stripe` | — (signature) | Webhook sink, raw body, timestamp tolerance |
| POST | `/api/webhooks/razorpay` | — (signature) | Webhook sink, raw body |
| GET | `/api/clerk/queue` | clerk | Paid apps awaiting review |
| POST | `/api/clerk/applications/:ref/approve` | clerk | → `REGISTERED` |
| POST | `/api/clerk/applications/:ref/reject` | clerk | → `REJECTED`, reason required |
| POST | `/api/applications/:ref/refund` | clerk/admin | Initiate refund |
| GET | `/api/admin/payments` | admin | Filter + paginate |
| GET | `/api/admin/payments/:id/timeline` | admin | Merged event timeline |
| GET | `/api/admin/jurisdictions` | admin | Pack registry with provenance + routing |
| GET | `/api/admin/reconciliation` | admin | Dashboard data, per provider |
| POST | `/api/admin/reconciliation/run` | admin | Force reconcile |
| POST | `/api/admin/webhooks/:id/replay` | admin, non-prod | Idempotency demo |

---

## 7. Testing strategy

**Unit (fast, no I/O)**
- `Money`: same-currency arithmetic; **cross-currency operation throws**;
  exponent 0 / 2 / 3 formatting and parsing round-trips.
- Fee engine: every component kind (flat, proportional, progressive bands);
  **exact band-boundary values** (one minor unit below, at, and above each
  bound); each rounding mode; conditional relief applying and not applying;
  each basis strategy.
- **Golden-file tests per jurisdiction pack**, auto-discovered by globbing the
  pack directory — so a new pack that lacks fixtures fails CI.
- State machines: legal and illegal transitions exhaustively.
- Signature verification per provider: valid, tampered body, tampered
  signature, truncated, wrong secret, and for Stripe an **expired timestamp**.

**Integration (real DB, fake provider)** — happy path create → pay → capture →
receipt, run **once per shipped jurisdiction** so multi-currency is exercised
end to end; duplicate webhook applies once; out-of-order webhooks converge;
webhook lost entirely then reconciliation heals it; concurrent double
order-create yields one payment; refund full cycle; illegal refund rejected;
ledger sums to zero per currency after refund; unroutable jurisdiction and
unsupported-currency routing both fail at boot.

**Contract (real sandboxes, tagged, opt-in)** — per provider: order/intent
creation shape, webhook payload shape, refund shape, and a zero-decimal
currency amount where supported. Proves each adapter matches reality and
catches gateway drift. Not in the default run.

**E2E (Playwright)** — citizen pays in **two different currencies through two
different providers**; clerk approves; clerk rejects and refunds; admin sees the
timeline and the jurisdiction registry.

**Authorization tests (own suite)** — each role against every endpoint,
expecting allow or `403`; **a citizen reading another citizen's application and
receipt must fail**; role taken from a body/header/query is ignored; expired and
tampered JWTs rejected.

**Adversarial cases that must have tests** — replayed webhook; wrong-secret
webhook; Stripe webhook with stale timestamp; client posting a tampered amount;
client posting a **tampered currency**; double-submit of refund; payment
captured for an amount other than assessed; **captured in a different currency
than assessed**; browser abandoned mid-payment; a `SYNTHETIC` pack reaching a
receipt without its disclaimer.

TDD: `Money`, fee engine, and state machines are written test-first. Adapters
are written against the fake, then verified against sandbox.


---

## 8. Milestones

| # | Milestone | Deliverable |
|---|---|---|
| **M0** | Skeleton | Monorepo (`payment-gateway/` in `allubalu`), TS strict, Prisma + SQLite, health check, CI running lint + tests |
| **M0b** | Auth | User table, seed script, bcrypt, login + JWT, role and ownership guards, authz tests |
| **M1** | Money + currency | `Money` value object, currency registry with exponents, formatting, lint rule, full unit tests |
| **M2** | Fee engine + first pack | Pure engine with all three component kinds, pack loader + Zod schema, provenance guard + synthetic banner plumbing, `IN-TG` pack, golden fixtures |
| **M3** | Application lifecycle | Pack-driven form metadata, create/read application, state machine, expiry, ledger `FEE_ASSESSED` |
| **M4** | Payment happy path, one provider | `PaymentProvider` port, first adapter, hosted checkout, verified webhook, `CAPTURED`, ledger entry |
| **M5** | Correctness hardening | Idempotency, out-of-order, transactional handler, reconciliation job, `FakeProvider` scenario harness |
| **M6** | **Wired tier completed** | `GB-ENG` (progressive bands + relief) and `JP` (zero-decimal) packs, wired end to end. **Proves the abstraction: no engine code changes.** |
| **M6b** | **Dubai + California wired** | `AE-DU` (flat percentage, `CONSIDERATION_ONLY`, conditional mortgage component) and `US-CA` (stacked county + city proportional taxes over per-document flat fees, component min and cap, county sub-schedule attribute) — both selectable, payable and receipted in the UI. `SG` pack + golden fixtures + admin registry view stays data-only. If any of these needs engine code, the abstraction is wrong — stop and fix it. |
| **M7** | **Second provider** | Razorpay adapter alongside Stripe, routing config, boot-time currency-capability validation, canonical-event parity tests |
| **M8** | Review + refund | Clerk queue, approve/reject, refund initiate + refund webhook, ledger to zero per currency |
| **M9** | Receipt | Locale- and currency-correct PDF from persisted data, ownership-checked download |
| **M10** | Admin console | Payments list with currency/provider filters, timeline, reconciliation dashboard, jurisdiction registry, replay tool |
| **M11** | Polish | E2E suite across two currencies, README with tunnel walkthrough per provider, seed script, architecture notes |

**M6 and M7 are the milestones that matter most** — they are where the design
is falsified or proven. If adding a jurisdiction or a provider turns out to
require touching the engine or the services, the abstraction was wrong and the
plan should stop and correct it rather than pile on special cases.

M0–M7 are the core value. M8–M11 complete the story.

---

## 9. Success criteria

The POC is done when all of these are demonstrable:

1. A citizen completes a real sandbox payment **in at least two different
   currencies through two different providers** and downloads a correct receipt
   for each.
2. **A zero-decimal currency (JPY) is charged and displayed correctly** —
   `¥1,250,000`, not `¥12,500.00`.
3. **Six jurisdictions load and compute correctly**, spanning proportional,
   progressive-band, stacked-band, flat-plus-proportional, and
   stacked-proportional-over-bounded-flat models — with **zero
   jurisdiction-specific branches** in the engine.
3c. **Five of the six are payable end to end from the UI** — India, England,
    Japan, Dubai and California — each quoting, charging and receipting in its
    own currency through its routed gateway.
3d. **A sub-jurisdictional attribute changes the fee without a new pack**:
    switching the California county selects a different flat-fee and city-tax
    sub-schedule inside `US-CA` alone.
3a. **Adding a jurisdiction is a single JSON file + fixtures**, demonstrated
    live with no TypeScript change and no rebuild of domain code.
3b. **Every pack shows its `SYNTHETIC` banner** in the citizen UI, the API
    response, and the receipt PDF.
4. Replaying the same webhook twice changes state and ledger exactly once —
   shown live via the admin replay tool, for each provider.
5. With webhooks deliberately blocked, reconciliation converges the payment to
   `CAPTURED` within one interval.
6. A tampered **amount or currency** from the client is rejected; server-computed
   values win.
7. A tampered webhook signature — and a stale Stripe timestamp — are rejected,
   stored, and flagged, with no state change.
8. A rejected application refunds fully in its original currency and its ledger
   sums to zero for that currency.
9. Per-currency `sum(ledger)` invariant holds after the full automated suite,
   and **no code path sums across currencies**.
10. A `SYNTHETIC` pack surfaces its disclaimer on every fee display and on the
    receipt.
11. No float arithmetic on money anywhere — verified by lint rule.
12. `grep -ri 'stripe\|razorpay' src/ --exclude-dir=adapters` returns nothing.
13. **A citizen cannot read another citizen's application or receipt**, proven
    by test, not by inspection.
14. No secret, password hash, or PII appears in any log or in git history.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Going international multiplies scope** — N jurisdictions × M providers | Cap: **6 packs, 2 providers**, of which **5 are wired end to end** (FR-11a). Providers stay hard-capped at 2 — that is the axis that costs code. Packs cost a JSON file plus fixtures, which is the whole point. |
| Five wired packs tempt five full E2E flows | **Two full E2E flows only** — `IN-TG` (Razorpay, INR) and `JP` (Stripe, zero-decimal) — because those two cover both providers and both exponent classes. `GB-ENG`, `AE-DU` and `US-CA` get an API-level integration test through the create → capture → receipt path, not a browser flow. Wired means payable, not separately Playwright-driven. |
| Fee rates fabricated or presented as authoritative | **Blocking guard (FR-10):** boot fails on unmarked rates; `SYNTHETIC` packs banner-marked in UI, API, and receipt |
| Multi-currency bugs that only appear for one exponent class | Test matrix mandates exponent 0, 2, and 3 coverage; JPY in the shipped set |
| Cross-currency summing sneaking into an admin aggregate | `Money` throws on mixed-currency arithmetic; all aggregates `GROUP BY currency`; explicit test |
| Provider vocabulary leaking into the domain | Canonical event model (GW-2) plus the grep check in success criterion 12, enforced in CI |
| Two providers → two sandbox accounts, two tunnels, more setup friction | One provider fully working (M4–M5) before the second (M7); README documents each independently |
| Razorpay sandbox UPI behaviour differs from live | Contract tests pin observed sandbox shapes; documented as a known POC limitation |
| SQLite write concurrency under concurrent webhooks | WAL mode; short transactions; schema portable to Postgres if it bites |
| Scope creep into a production system or a real tax calculator | Non-goals in §1.4 are the contract |

---

## 11. Decisions and open items

### 11.1 Decisions taken

| Decision | Resolution |
|---|---|
| **Gateways** | **Stripe primary** (multi-currency, `stripe listen` needs no tunnel) + **Razorpay routed for `IN-*`** to keep UPI. Supersedes the earlier Razorpay-only choice, which cannot charge GBP/JPY/AED. |
| **Jurisdiction packs** | All six: `IN-TG`, `GB-ENG`, `JP`, `AE-DU`, `US-CA`, `SG`. **Five are wired** — Dubai and California are payable in the UI alongside India, England and Japan (FR-11a, FR-11b). `SG` stays fixture-tier. E2E scope is bounded at the browser-flow level instead (§10), not by leaving jurisdictions unpayable. |
| **Rate provenance** | **All packs `SYNTHETIC`** with banners in UI, API, and receipt. No fabricated figures presented as authoritative; the sourcing lane (FR-10) exists and is unused for now. |

| **Repo** | New folder `payment-gateway/` inside `allubalu`, sibling to `grpc-streaming` and `mcp-rbac-demo`. |
| **Auth** | Seeded users with email + password, bcrypt, JWT, role **and** ownership checks (§4.10). |
| **Notifications** | **Out of scope.** No email/SMS/push, and therefore no queue and no outbox — the webhook handler has no slow side-effect to defer (GW-14). |

### 11.2 Remaining questions

None blocking. Open items are deferred by design, not undecided:

- Refresh tokens, password reset, MFA — deliberately out of scope (§1.4).
- Partial refunds — modelled in schema, not exposed (REF-5).
- Postgres migration — schema is already portable (NFR-10); switch is a
  connection string when SQLite concurrency becomes a problem.
- Promoting a fixture-tier pack to the wired tier — config-only (FR-11a).
