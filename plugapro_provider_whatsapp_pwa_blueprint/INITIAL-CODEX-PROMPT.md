# Initial Prompt to Run Provider WhatsApp + PWA Blueprint in Codex

Paste this into Codex from the repository root:

```text
Read and execute the Provider WhatsApp + PWA blueprint controller file:

plugapro_provider_whatsapp_pwa_blueprint/00-PROVIDER-WHATSAPP-PWA-MASTER-RUNNER.md

Follow it exactly.

Important:
- This is for the service provider journey.
- Treat WhatsApp as the primary provider execution channel.
- The provider must be able to complete the core journey end to end in WhatsApp.
- Treat the PWA as optional and useful for richer screens, dashboard, profile management, credit history, job cards, images, and history.
- Start with 01-provider-as-is-assessment.md.
- Execute the blueprint files in the sequence defined by the master runner.
- After each blueprint file, write the required physical Markdown output file into docs/provider-whatsapp-pwa-execution/.
- Update docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md after each step.
- Do not create one final implementation summary.
- Each blueprint file must produce its own implementation output file.
- Reuse existing WhatsApp bot, webhook, provider, worker portal, credit, lead, job, image, token, and notification logic wherever practical.
- Do not create duplicate WhatsApp state machines, duplicate provider journeys, duplicate credit systems, or parallel route systems.
- Ensure core provider actions work in WhatsApp:
  - apply/register
  - check credits
  - view safe opportunity preview
  - respond interested / not interested
  - submit call-out fee
  - submit estimated arrival
  - accept selected job
  - receive full customer details after acceptance
  - confirm arrival
  - mark on the way
  - mark arrived
  - start job
  - complete job
- Ensure PWA is not required for normal provider operations.
- Ensure old WhatsApp links resolve to the correct current PWA state where PWA links are used.
- Ensure production links use https://app.plugapro.co.za and never localhost.
- Enforce privacy server-side: provider previews must not expose customer phone, exact address, GPS coordinates, access notes, or private notes before selected-provider acceptance.
- Provider credit is deducted only when the customer-selected provider accepts the selected job.
- Credit deduction and job assignment must be atomic.
- Stop only if the master runner stop conditions are met.
```
