# Execution Output — 01-provider-as-is-assessment.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/01-provider-as-is-assessment.md`

## Objective

Perform a focused as-is assessment of the current service-provider WhatsApp journey, provider PWA journey, credit wallet, lead acceptance, selected-provider acceptance, job execution, signed handoff links, and privacy boundaries before implementing WhatsApp-complete provider changes.

## Current-state findings

The current provider implementation is partly WhatsApp-complete and partly PWA-dependent.

Actions that currently work fully in WhatsApp:

- Provider registration/application is started from WhatsApp with `join`/registration flow support and provider-application continuation after timeout.
- Application status can be checked from WhatsApp for pending applications.
- Provider menu/status/help are available from WhatsApp.
- Availability can be toggled in WhatsApp: go available, pause today, pause until manual reactivation.
- Credit balance is displayed in the provider menu/status via read-only wallet balance.
- Active job list can be opened with provider keywords such as `my jobs`, `myjobs`, `my work`, and `jobs`.
- Existing `Job` rows can be moved through `SCHEDULED -> EN_ROUTE -> ARRIVED -> STARTED -> PENDING_COMPLETION_CONFIRMATION` from WhatsApp.
- Selected-provider final acceptance/decline has WhatsApp button handlers: `confirm_accept:<leadId>` and `confirm_decline:<leadId>`.
- Qualified-shortlist provider opportunity response has direct button handlers: `interested:<leadId>` and `not_interested:<leadId>`.

Actions that require or heavily depend on PWA today:

- Rich provider profile/dashboard management.
- Detailed availability schedule editing.
- Credit ledger/history and top-up/payment screens.
- Full lead/job preview from a secure CTA link.
- Structured opportunity response fields beyond a one-tap response, especially call-out fee and estimated arrival.
- Full accepted-job details, customer contact actions, customer address viewing, photos, and accepted-job action panel.
- Arrival window editing and richer accepted-job status controls for accepted leads.
- Completion notes/photos/history.

Existing WhatsApp provider commands and button IDs:

- Text triggers: `available`, `online`, `im available`, `i'm available`, `ek is beskikbaar`, `offline`, `not available`, `not working`, `ek is nie beskikbaar`, `provider menu`, `my dashboard`, `myjobs`, `my jobs`, `my work`, `jobs`, `accept`.
- Provider menu/list buttons: `provider_available_jobs`, `provider_my_jobs`, `provider_check_status`, `provider_availability`, `provider_pause_leads`, `provider_pause_today`, `provider_pause_manual`, `provider_pause_cancel`, `provider_go_available`, `provider_worker_portal`, `provider_service_areas`, `provider_profile`, `provider_support`, `provider_status`, `provider_application_status`, `provider_update_application`, `provider_top_up_credits`.
- Legacy/matching buttons: `accept:<holdId>`, `decline:<holdId>`, `match_accept_<leadId>`, `match_inspect_<leadId>`, `match_decline_<leadId>`, decline reason IDs beginning `hd_` and `mdc_`.
- Qualified-shortlist buttons: `interested:<leadId>`, `not_interested:<leadId>`, `confirm_accept:<leadId>`, `confirm_decline:<leadId>`.
- Provider job buttons: `pj_view_jobs`, `pj_toggle`, `pj_go_online`, `pj_go_offline`, `pj_job_<jobId>`, `pj_lead_<leadId>`, `pj_upd_<jobId>_<status>`.

Existing provider routes:

- Authenticated provider PWA: `/provider`, `/provider/availability`, `/provider/credits`, `/provider/earnings`, `/provider/jobs/[id]`, `/provider/leads`, `/provider/leads/[leadId]`, `/provider/profile`, `/provider/quotes/[matchId]`, `/provider/terms/credits`.
- Signed/optional provider handoff: `/leads/access/[token]`, `/provider/jobs/[jobId]/handover?token=...`, `/provider/jobs/[jobId]/quick-update?token=...`, `/provider/jobs/[jobId]/arrival?token=...`.
- Legacy technician routes still exist under `/technician` and `/api/technician/...`.

Existing webhook handlers:

- Main WhatsApp webhook processing lives in `field-service/lib/whatsapp-bot.ts`.
- Provider journey routing is delegated to `field-service/lib/whatsapp-flows/provider-journey.ts`.
- Provider application/registration flow is delegated through the registration flow.
- Stateless notification-response intercepts process assignment holds, legacy match lead actions, qualified-shortlist interested/not-interested, and selected-provider confirmation outside normal session state.
- Provider job updates use `provider_journey` and legacy `provider_job` flow handling.

Existing provider APIs/server actions:

- `GET/POST /api/provider/opportunities/[leadId]` exposes authenticated safe opportunity preview and response capture.
- `POST /api/provider/assignment-offers/[id]/accept` and `/reject` exist for assignment offers.
- `POST /api/provider/leads/[leadId]/contact-customer` exists for provider customer-contact action.
- Wallet top-up APIs exist under `/api/provider/wallet/top-up-intents`.
- Provider credits page server actions expose wallet summary, ledger, and top-up intent creation.
- Signed `/leads/access/[token]` server actions support legacy accept/decline, accepted-lead arrival saving, and accepted-lead status actions.

Existing credit services:

- `field-service/lib/provider-wallet.ts` and related ledger logic keep paid and promo credits separate.
- `field-service/lib/lead-unlocks.ts` performs lead unlock debit inside a transaction, creates a `LeadUnlock`, and writes wallet ledger entries.
- `field-service/lib/selected-provider-acceptance.ts` uses `unlockLeadForProviderInTransaction` inside the same transaction that creates match, quote, booking, job, status event, and audit records.
- `field-service/lib/provider-credit-copy.ts` centralizes provider credit copy and public URL generation.
- Current credit model is aligned with the Qualified Shortlist rule for selected-provider acceptance, but some legacy UI/WhatsApp copy still says "accepted lead" and can imply earlier charging.

Existing job status flows:

- Authenticated/signed PWA accepted-job actions can save arrival time and mark customer contacted, on the way, arrived, started, and completed for accepted leads.
- WhatsApp active `Job` status updates call `transitionJob` and support on-the-way, arrived, start, pause/resume, and ready-for-sign-off.
- WhatsApp accepted-lead rows currently produce a signed PWA handoff instead of completing all accepted-lead actions inline in WhatsApp.
- Completion with notes/photos is not WhatsApp-complete today.

Existing secure token/access model:

- Provider lead/job handoffs use HMAC-signed tokens from `field-service/lib/provider-lead-access.ts`.
- Tokens include lead id, provider id, optional job request id, optional provider phone hash, scopes, JTI, and expiry.
- Scopes include `view_lead`, `accept_lead`, `decline_lead`, `view_job`, `confirm_arrival`, `mark_customer_contacted`, `mark_on_the_way`, `mark_arrived`, `start_job`, `complete_job`, and `contact_customer`.
- `/provider/jobs/[jobId]/handover` validates token status and scope, audits the view, and redirects to `/leads/access/[token]`.
- Expired signed job links can request a fresh link to the accepted provider WhatsApp number.

Privacy rules currently enforced:

- `getSafeProviderOpportunityPreview` excludes customer phone/email/name, street, unit, complex, access notes, GPS, and private notes before acceptance.
- `getProviderLeadDetailForProvider` fetches sensitive customer/address details only after lead status is `ACCEPTED` and the provider owns the unlock.
- `resolveProviderLeadAccessToken` truncates preview description before accepted unlock and only injects customer/full address details after accepted unlock.
- Preview attachments are filtered by `safeForPreview`.

Current gaps blocking WhatsApp-complete provider journey:

- Opportunity preview is primarily a PWA CTA; WhatsApp does not yet deliver the full safe preview summary and safe photos inline.
- `interested:<leadId>` currently cannot collect call-out fee and estimated arrival through a structured WhatsApp conversation before calling `respondToProviderOpportunity`.
- Full customer details after selected-provider acceptance are sent as a PWA job link, not fully delivered inline in WhatsApp.
- Accepted-lead job execution is split: WhatsApp can list accepted leads and link out, while PWA handles arrival/contact/on-the-way/arrived/start/complete actions.
- Completion notes/photos/history are not WhatsApp-complete.
- Legacy lead acceptance routes and copy still coexist with the Qualified Shortlist model and need careful routing/copy alignment.
- Provider PWA routes and legacy technician routes overlap, so route reuse must avoid another parallel provider route system.

## Implementation completed

- Created `docs/provider-whatsapp-pwa-execution/001-provider-as-is-assessment-output.md`.
- Initialized `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md`.
- No product behavior changed in this step.

## Files changed

| File | Change summary |
|---|---|
| `docs/provider-whatsapp-pwa-execution/001-provider-as-is-assessment-output.md` | Step 1 required provider as-is assessment output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Provider WhatsApp + PWA execution index |

## WhatsApp flow changes

None.

## PWA route/screen changes

None.

## API/server changes

None.

## Credit impact

None.

## Security/privacy impact

No behavior changed. Existing server-side privacy boundaries were documented, including safe provider opportunity preview, signed provider lead/job tokens, scoped token validation, and accepted-unlock-only access to customer phone and exact address.

## Tests added or updated

None. This step was documentation-only.

## Commands run

```bash
find field-service/app -path '*provider*' -type f | sort
find field-service/app -path '*technician*' -type f | sort
rg -n "provider|credits|credit|lead|opportunity|interested|arrival|on the way|arrived|complete|handoff|token|accept selected|selected provider|confirm_accept|mark arrived|start job|my jobs|wallet" ...
sed -n ... field-service/lib/whatsapp-flows/provider-journey.ts
sed -n ... field-service/lib/whatsapp-bot.ts
sed -n ... field-service/lib/provider-opportunity-responses.ts
sed -n ... field-service/lib/selected-provider-acceptance.ts
sed -n ... field-service/lib/provider-lead-access.ts
sed -n ... field-service/lib/provider-lead-detail.ts
sed -n ... field-service/lib/lead-unlocks.ts
sed -n ... field-service/lib/provider-credit-copy.ts
sed -n ... field-service/app/api/provider/opportunities/[leadId]/route.ts
sed -n ... field-service/app/leads/access/[token]/page.tsx
sed -n ... field-service/app/provider/jobs/[jobId]/handover/page.tsx
sed -n ... field-service/app/(provider)/provider/page.tsx
sed -n ... field-service/app/(provider)/provider/credits/page.tsx
```

## Test results

Not run for this documentation-only assessment step.

## Manual verification checklist

- [x] Existing WhatsApp provider commands documented.
- [x] Existing provider routes documented.
- [x] Existing webhook handlers documented.
- [x] Existing provider APIs/server actions documented.
- [x] Existing credit services documented.
- [x] Existing job status flows documented.
- [x] Existing secure token/access model documented.
- [x] Current gaps documented.
- [x] Reuse recommendations documented.
- [x] Implementation risks documented.

## Risks and follow-ups

- Reuse `provider-journey.ts` as the canonical WhatsApp provider state machine instead of adding another provider bot flow.
- Reuse `respondToProviderOpportunity`, `acceptSelectedProviderJob`, `unlockLeadForProviderInTransaction`, and provider lead token services instead of creating duplicate response, acceptance, credit, or token systems.
- Preserve server-side privacy by keeping preview/full-detail separation in the service layer, not only in UI copy.
- Align legacy lead acceptance copy and buttons with Qualified Shortlist semantics so providers are not charged before customer selection.
- Route old PWA links through current signed handoff resolution rather than introducing a second provider handoff route family.

## OpenBrain note

Provider WhatsApp + PWA as-is assessment completed. The system already has reusable provider menu, availability, wallet, signed token, safe preview, selected-provider acceptance, and accepted-job action services. The main implementation work is to move core opportunity response, selected-job detail delivery, arrival/status, and completion operations into the canonical WhatsApp provider journey while keeping the PWA as an optional rich handoff layer.
