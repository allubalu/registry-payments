# Architecture

Structural decisions and layout. See [README](../README.md) for the overview.

## Architecture

Two independent axes of pluggability, deliberately kept apart:

```mermaid
flowchart TB
    subgraph data["JURISDICTION — data"]
        P1[IN-TG.json]
        P2[GB-ENG.json]
        P3[JP.json]
        P4[AE-DU.json]
        P5[US-CA.json]
        P6[SG.json]
    end

    subgraph engine["ENGINE — pure, no I/O, no jurisdiction branches"]
        L[loader<br/>Zod validation<br/>fails boot on any invalid pack]
        B[basis<br/>named strategy]
        C[condition<br/>8-operator union]
        K[components<br/>FLAT · PROPORTIONAL · BANDS]
        F[computeFee<br/>FeeBreakdown]
        L --> B --> K
        C --> K
        K --> F
    end

    subgraph code["PROVIDER — code"]
        A1[Stripe adapter]
        A2[Razorpay adapter]
        A3[Fake adapter]
    end

    data --> L
    F -.->|"amountMinor + currency"| R[routing config]
    R --> code

    style data fill:#e8f4ea,stroke:#4a7c59
    style engine fill:#eef1f8,stroke:#4a5c8c
    style code fill:#faf0e6,stroke:#8c6d4a
```

**Jurisdiction is data. Provider is code. They meet only in routing config.**

Conflating them is the design mistake this structure exists to avoid: if the fee
rules lived in code, every new country would be a deployment; if the gateway
integration lived in data, the adapter's error handling would be
unrepresentable. Six countries cost six JSON files. Two gateways cost two
adapters. Neither multiplies the other.

The engine contains **zero jurisdiction-specific branching**, and that is
enforced by a test that reads the source (see
[The guards](#the-guards-tests-that-read-the-source)).

---


## Layout

```
payment-gateway/
├── packages/domain/          Pure domain. No I/O except the pack loader.
│   ├── src/money/            Money, currency registry, rounding, wire, format
│   ├── src/fees/             Schema, condition, basis, components, compute, loader
│   └── tests/
│       ├── money/  fees/     Unit and golden tests
│       └── guards/           Tests that read the source text
├── config/
│   ├── jurisdictions/        6 versioned rule packs — SYNTHETIC data
│   └── fixtures/             19 golden cases pinning every computation
├── tools/quote.ts            CLI; the HTTP quote endpoint will do the same work
├── design/                   Interface design canvas (15 artboards)
└── docs/superpowers/
    ├── specs/                Requirements (PRD)
    └── plans/                Implementation plans
```

### Interface design

Fifteen screens — citizen flow in nine, operations in four, plus foundations —
covering the jurisdiction picker, per-market quote screens for all five wired
jurisdictions, hosted checkout, a declined state, a print-fidelity receipt, the
clerk queue, the admin event timeline, reconciliation, and the jurisdiction
registry:

**[View the design canvas →](https://claude.ai/code/artifact/688c8d90-3d7d-424e-81e3-e144c7d10179)**

---

