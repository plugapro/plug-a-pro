# Legacy Journey Diagrams (retired 2026-05-02)

These diagrams describe the **old** Plug A Pro operating model and are retained for historical reference only. Do not use them for product, engineering, QA, or operations decisions.

## Why retired

The old diagrams reflect:
- A PWA-led provider model (provider unlock + accept happened on the PWA in one step)
- Sequential single-provider dispatch (no shortlist, no comparison UI)
- Credit deducted on the first provider's acceptance (legacy `acceptLead` paid path)
- Customer details unlocked at the same moment a provider tapped Accept

The current model (Qualified Shortlist) is fundamentally different:
- WhatsApp-first / WhatsApp-complete provider journey, with PWA as optional
- WhatsApp-first customer journey with structured PWA handoff for shortlist comparison
- Top-N broadcast → INTERESTED responses (with rate + ETA, free) → customer-facing shortlist → customer selection → selected provider's final acceptance
- Credit deducted **exactly once**, on selected-provider final acceptance, atomically with privacy unlock

## Retired files

- `provider-journey.html` — old PWA-led provider model
- `provider-journey.png` — visual export of the same
- `customer-journey.html` — old sequential-dispatch customer model
- `customer-journey.png` — visual export of the same

## Use these instead

- `docs/journeys/provider-journey-v2.html`
- `docs/journeys/customer-journey-v2.html`
- `docs/journeys/matching-shortlist-credit-flow-v2.html`
- `docs/journeys/diagram-regeneration-summary.md` — full audit log of the regeneration
