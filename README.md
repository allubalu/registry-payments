# Registry Payments

Property registration payment service — a proof of concept demonstrating
exactly-once money handling, webhook-as-source-of-truth, and jurisdiction
pluggability across six markets.

**All fee rates in `config/jurisdictions/` are synthetic.** They are
illustrative demonstration data and are not any jurisdiction's actual
statutory fees, and no output of this system is an official assessment.
See `docs/superpowers/specs/` for the full requirements.

## Layout

| Path | Contents |
|---|---|
| `packages/domain` | Pure domain: money, fee engine, rule pack loader. No I/O. |
| `config/jurisdictions` | Versioned fee rule packs, one JSON file per jurisdiction. |
| `config/fixtures` | Golden expected outputs, one per pack. |
| `tools/quote.ts` | CLI that computes a quote from a pack. |
| `design/` | Interface design canvas (`.dc.html` artboards + `canvas.json`). |
| `docs/superpowers/specs` | Requirements. |
| `docs/superpowers/plans` | Implementation plans. |

## Commands

```bash
npm install
npm test             # unit tests
npm run lint         # oxlint
npm run build        # type-check and emit
npm run quote -- --all
```

## Adding a jurisdiction

Add one JSON file to `config/jurisdictions/` and one to `config/fixtures/`.
No TypeScript changes. The golden test suite discovers packs by globbing, so
a pack without fixtures fails CI.
