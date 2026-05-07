# Execution Output — 01-provider-as-is-assessment.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/01-provider-as-is-assessment.md

## Objective
Perform a focused as-is assessment of the current provider WhatsApp journey, provider PWA journey, credits, lead acceptance, job execution, and handoff behaviour. Answer 15 specific questions about what exists vs what is missing, with concrete file references.

---

## Current-state findings

### Q1. Which provider actions currently work fully in WhatsApp?

All 12 core provider actions are marked `whatsapp: 'existing'` in `lib/provider-channel-responsibility.ts`. Specifically:

| Action | WhatsApp path |
|---|---|
| Apply / register | `registration` flow — `lib/whatsapp-flows/registration.ts` via `reg_start` |
| Profile, service area, availability, rate capture | Registration flow captures all fields inline |
| Application status check | `pj_provider_status` step — command `status` / aliases `provider status`, `application status` |
| Check credits balance | `pj_provider_status` + `buildProviderCreditSummaryMessage()` in `lib/provider-credit-copy.ts:227` |
| View safe opportunity preview | `buildProviderLeadPreviewMessage()` in `lib/provider-credit-copy.ts:310` — category, area, urgency, budget, photo count, deadline, signed CTA link |
| Respond interested / not-interested with call-out fee + ETA | `interested:<leadId>` / `not_interested:<leadId>` intercepts; multi-step `parseProviderInterestRateText()` in `lib/provider-whatsapp-interest-capture.ts` |
| Accept customer-selected job (spend 1 credit) | `confirm_accept:<leadId>` handler → `acceptSelectedProviderJob()` in `lib/selected-provider-acceptance.ts:85` |
| Receive full customer details after selected-job acceptance | Inline in `notifySelectedAcceptanceCommitted()` — `lib/selected-provider-acceptance.ts:388` |
| Confirm arrival time | Text command `HH:MM` or `confirm arrival HH:MM` → `parseProviderJobCommand()` in `lib/provider-whatsapp-job-commands.ts:132` |
| Job status updates (on the way, arrived, start, pause) | `executeProviderJobCommand()` in `lib/provider-whatsapp-job-commands.ts:304` |
| Complete job with notes/photos | `completeProviderJobFromWhatsApp()` in `lib/provider-whatsapp-job-commands.ts:491` |
| Help / menu / provider status | Commands `menu`, `help`, `support` in `PROVIDER_WHATSAPP_COMMANDS` — `lib/provider-whatsapp-command-model.ts:30` |

Running-late notification, dispute raising, and invoice sending are also handled in `lib/whatsapp-flows/provider-journey.ts` (triggers: `running late`, `dispute`, `invoice`).

---

### Q2. Which provider actions require PWA today?

Actions with `primaryChannel: 'pwa'` in `lib/provider-channel-responsibility.ts:147`:

- **Credit ledger / payment history** — `optionalPwaPath: '/provider/credits'`
- **Advanced dashboard** — document management, job history, performance stats — `optionalPwaPath: '/provider'`

All other core actions have `primaryChannel: 'whatsapp'` with `pwa: 'optional'`. The PWA is additive, not required, for approved providers post-onboarding.

The `lib/provider-pwa-dashboard.ts` profile completeness model covers: name, phone, services, areas, experience, rates, bio/portfolio — none of these fields are PWA-gated, all can be set via WhatsApp registration.

---

### Q3. What provider PWA routes exist?

**Authenticated PWA routes** (`app/(provider)/provider/`):
- `/provider` — dashboard home (`app/(provider)/provider/page.tsx`)
- `/provider/profile` — profile editing
- `/provider/availability` — availability toggle
- `/provider/credits` — credits balance and top-up
- `/provider/earnings` — earnings history
- `/provider/jobs` — active and past jobs list
- `/provider/jobs/[id]` — job detail
- `/provider/leads` — leads list
- `/provider/leads/[leadId]` — lead detail
- `/provider/quotes` — quotes list
- `/provider/quotes/[matchId]` — quote detail

**Token-gated (unauthenticated) deep-link routes** (`app/provider/`):
- `/provider/handoff/[token]` — WhatsApp CTA entry point; resolves token and redirects to `/leads/access/[token]` or `/provider/jobs` (`app/provider/handoff/[token]/page.tsx`)
- `/provider/lead/[token]` — alias for `/provider/handoff/[token]` (`app/provider/lead/[token]/page.tsx`)
- `/provider/job/[token]` — alias for `/provider/handoff/[token]` (`app/provider/job/[token]/page.tsx`)
- `/provider/jobs/[jobId]/handover` — signed-token job detail entry with expiry/scope error states (`app/provider/jobs/[jobId]/handover/page.tsx`)
- `/provider/jobs/[jobId]/arrival` — arrival confirmation
- `/provider/jobs/[jobId]/quick-update` — quick status update
- `/provider/terms/credits` — provider credits T&C

**Auth routes** (`app/(auth)/`):
- `/provider-sign-in` — OTP send
- `/provider-verify` — OTP verify → links provider to Supabase user

---

### Q4. What WhatsApp commands exist?

Canonical command table from `lib/provider-whatsapp-command-model.ts:30` (`PROVIDER_WHATSAPP_COMMANDS`):

| Command | Key aliases | State |
|---|---|---|
| `menu` | menu, hi, hello, start, provider menu, home | `approved_idle` |
| `credits` | credits, credit, balance, wallet, wallet history | `approved_idle` |
| `jobs` | jobs, my jobs, myjobs, my work, active jobs | `accepted_job_active` |
| `status` | status, provider status, application status | `approved_idle` |
| `profile` | profile, my profile, services, areas, service areas | `approved_idle` |
| `availability` | availability, available, online, go available | `approved_idle` |
| `unavailable` | unavailable, offline, not available, pause, break, back later… | `approved_idle` |
| `help` | help, support | `support` |
| `opportunities` | opportunities, available jobs, find work, find jobs, leads | `opportunity_review` |
| `interested` | interested | `opportunity_review` |
| `not_interested` | not interested, pass | `opportunity_review` |
| `accept_job` | accept job, accept selected job | `customer_selected_pending_acceptance` |
| `decline` | decline, decline job | `opportunity_review` |
| `on_the_way` | on the way, otw, en route | `job_execution` |
| `arrived` | arrived, i arrived, i've arrived | `job_execution` |
| `start` | start job, start work | `job_execution` |
| `complete` | complete, complete job, done, finish job | `job_completion` |
| `issue` | issue, problem, report issue | `support` |
| `register` | register, apply, join | `application_capture` |

Text-command extensions from `lib/provider-whatsapp-job-commands.ts` (parsed before the menu-based path):
- `HH:MM` / `confirm arrival HH:MM` / `arrive HH:MM` / `arrive in N hours` / `arrive noon`
- `on the way` / `otw` / `en route` / `arrived` / `start` / `complete` / `done`
- Job-ref suffix `#PAP-JOB-XXXXXXXX` to target a specific job when multiple active jobs exist

Provider-journey triggers from `lib/whatsapp-flows/provider-journey.ts:40`:
- `running late`, `delayed`, `late`, `stuck in traffic` → running-late sub-flow
- `dispute`, `issue with job`, `raise issue` → dispute sub-flow
- `invoice`, `send invoice`, `receipt` → invoice sub-flow
- `verify`, `verification`, `verify identity`, `complete verification` → verification sub-flow

---

### Q5. How does provider onboarding work today?

1. Provider texts `register` / `apply` / `join` to the WhatsApp number.
2. Bot routes to `registration` flow (`lib/whatsapp-flows/registration.ts`), step `reg_start`.
3. Flow captures: name, skills (multi-select), service areas, experience, call-out rate, availability, optional evidence note/photos.
4. On submit: `ProviderApplication` row created with `status: PENDING`.
5. Confirmation message sent via `buildProviderApplicationSubmittedMessage()` — `lib/provider-credit-copy.ts:278` — with CTA "View credits rules" to terms page, no raw URL in body.
6. WhatsApp conversation state advances to `application_submitted` / `pending_review`.
7. Provider can reply to `MORE_INFO_REQUIRED` applications via `resumeMoreInfoApplication()` in `lib/provider-applications.ts:220`.

**Auto-approval cron** (`app/api/cron/provider-auto-approve/route.ts`): runs every 25 min during business hours (07:00–18:59 SAST), every ~55 min off-hours. Approves `PENDING` applications with all required fields. High-risk categories (Electrical, Roofing, Pest Control, Air Conditioning) require manual ops review and are excluded. Plumbing is standard and auto-approved.

---

### Q6. How does provider approval work today?

1. Auto-approve cron calls `autoApproveProviderApplications()` in `lib/provider-auto-approve.ts`.
2. On approval: `ProviderApplication.status` → `APPROVED`, `Provider` row created/activated.
3. Starter promo credits are awarded (amount from `promoAwards` with `awardType: MOBILE_VERIFIED`).
4. `notifyProviderApplicationApprovedOnce()` in `lib/provider-application-notifications.ts:86` sends exactly one WhatsApp notification using a distributed lock (`approvalWhatsappSendStartedAt` / `approvalWhatsappSentAt`) to prevent duplicate delivery.
5. Approval message (`buildProviderApplicationApprovedMessage()` — `lib/provider-application-notifications.ts:22`) includes: credit breakdown, 1 credit = R50 rule, "no credit to preview or show interest" explanation, "Worker Portal" CTA link.
6. A second message with terms CTA is sent immediately after.
7. Provider is now in `approved_idle` state and immediately eligible for lead matching.

---

### Q7. How are credits shown and deducted?

**Credit model** (`lib/provider-wallet.ts`):
- Two credit buckets: `paidCreditBalance` and `promoCreditBalance` on `ProviderWallet`.
- `totalCreditBalance = paid + promo`.
- Price: `PROVIDER_CREDIT_PRICE_ZAR = 50` (R50 per credit) — `lib/provider-wallet.ts:10`.
- Lead unlock cost: `LEAD_UNLOCK_COST_CREDITS = 1` — `lib/lead-unlocks.ts`.
- Debit order: promo credits consumed first, then paid credits — `lib/provider-wallet.ts:258`.
- Optimistic concurrency guard on debit prevents double-spend — `lib/provider-wallet.ts:267`.

**Credit display in WhatsApp**:
- `buildProviderCreditSummaryMessage()` — `lib/provider-credit-copy.ts:226` — shows total, starter, purchased, and explanatory copy.
- `buildProviderLeadPreviewMessage()` — `lib/provider-credit-copy.ts:310` — embeds live balance in every opportunity notification.
- After selected-job acceptance, `notifySelectedAcceptanceCommitted()` — `lib/selected-provider-acceptance.ts:388` — sends inline credit deduction line: "N credit used. Available credits: X credits".

**Ledger entry types** (`WalletLedgerEntry.entryType`): `TOPUP_CREDIT`, `PROMO_CREDIT`, `LEAD_UNLOCK_DEBIT`, `LEAD_REFUND_CREDIT`, `ADMIN_ADJUSTMENT`, `PROMO_EXPIRY`, `PAYMENT_REVERSAL`, `WALLET_SUSPENDED`, `WALLET_REACTIVATED`.

**Balance recomputation**: `recomputeWalletBalance()` — `lib/provider-wallet.ts:720` — replays all ledger entries to detect drift.

---

### Q8. How does provider receive and accept leads today?

**Opportunity dispatch** (inbound lead):
1. Matching engine dispatches a `Lead` row to matched providers.
2. Bot sends `buildProviderLeadPreviewMessage()` — safe preview only: category, area, preferred time, urgency, matching preference, photo count, deadline.
3. A signed CTA URL (`getProviderLeadAccessUrl()` — `lib/provider-lead-access.ts:168`) is appended via `sendCtaUrl` — no raw URL in body.
4. Provider can reply `interested:<leadId>` or `not_interested:<leadId>`.
5. On "interested": bot enters multi-step interest capture — collects call-out fee and ETA using `parseProviderInterestRateText()` — `lib/provider-whatsapp-interest-capture.ts:161`.
6. Customer shortlist is built from interested providers' responses.

**Customer-selected acceptance**:
1. When customer selects this provider, bot sends a "customer selected you" WhatsApp message with a `confirm_accept:<leadId>` reply button.
2. Provider replies with the confirm text → `acceptSelectedProviderJob()` — `lib/selected-provider-acceptance.ts:85`.
3. Transaction: `unlockLeadForProviderInTransaction()` debits 1 credit, creates `Match`, `Quote`, `Booking`, `Job`, `AuditLog`, expires competing leads.
4. `LEAD_UNLOCK_COST_CREDITS = 1` — full customer details unlock.

---

### Q9. Does provider receive full customer details in WhatsApp after acceptance?

**Yes.** `notifySelectedAcceptanceCommitted()` — `lib/selected-provider-acceptance.ts:388` — sends inline customer details in the WhatsApp text body immediately after the credit transaction commits:

```
Customer details:
Name: <customerName>
Phone: <customerPhone>
Address: <fullAddress>
Access notes: <accessNotes>

Job details:
Reference: <jobRef>
Preferred time: <window>
Job description: <description>
Photos: <count> available in the job link
```

A CTA button "View job" follows (`ctaLabelFor('job_detail')`) pointing to `getProviderSignedJobHandoverUrlByLeadId()` — a time-limited HMAC-signed token URL.

A second message notifies the customer: provider name, expected arrival, call-out fee, CTA to customer's ticket.

---

### Q10. Can provider confirm arrival in WhatsApp?

**Yes.** `executeProviderJobCommand()` with `kind: 'arrive'` — `lib/provider-whatsapp-job-commands.ts:335`:
- Parses `HH:MM`, `confirm arrival HH:MM`, `arrive in N hours`, `arrive noon`, `arrive later` via `parseProviderJobCommand()` — `lib/provider-whatsapp-job-commands.ts:132`.
- Updates `Job.scheduledArrivalAt` and `Job.arrivalTimeConfirmedAt`.
- Creates `JobStatusEvent` with `actorId: 'whatsapp:provider'`.
- Calls `notifyCustomerArrival()` — `lib/provider-whatsapp-job-commands.ts:463` — sends WhatsApp text to customer with provider name and confirmed arrival time.
- Returns confirmation text to provider: "Arrival time confirmed. Customer has been notified."
- Duplicate detection: if same-minute arrival already stored, returns "already confirmed" without re-notifying customer.

---

### Q11. Can provider update job status in WhatsApp?

**Yes.** `executeProviderJobCommand()` — `lib/provider-whatsapp-job-commands.ts:304` — handles:

| Text command | Job status transition |
|---|---|
| `on the way` / `otw` / `en route` | `SCHEDULED → EN_ROUTE` |
| `arrived` / `i arrived` | `EN_ROUTE → ARRIVED` |
| `start` / `start work` / `starting` | `ARRIVED → STARTED` |
| `complete` / `done` / `finished` | `STARTED → PENDING_COMPLETION_CONFIRMATION` |

Only strict forward transitions are allowed by `isAllowedForwardTransition()` — `lib/provider-whatsapp-job-commands.ts:419`. Non-linear transitions (e.g., complete before arrived) are rejected with a message directing to the menu.

Multi-job disambiguation: if provider has multiple active jobs, a `#JOBREF` suffix (`#PAP-JOB-ABCDE123`) is required; otherwise the bot returns `AMBIGUOUS_JOB` with instructions.

All transitions call `transitionJob()` — `lib/jobs.ts` — with `actorId: 'whatsapp:provider'`.

---

### Q12. Can provider complete a job in WhatsApp?

**Yes.** `completeProviderJobFromWhatsApp()` — `lib/provider-whatsapp-job-commands.ts:491`:
1. Provider must be in `STARTED` status (enforced).
2. Provider sends a text completion note (up to 1,000 chars) optionally followed by a photo (`attachmentId`).
3. `Job.completionNote` is updated; if photo is present, `Attachment` is updated with `label: 'completion_photo'`.
4. Job transitions to `PENDING_COMPLETION_CONFIRMATION` via `transitionJob()`.
5. Bot replies: "Job completed. The customer has been notified."
6. Duplicate guard: if already `PENDING_COMPLETION_CONFIRMATION` or `COMPLETED`, returns duplicate-safe response without re-notifying.

---

### Q13. What secure token/handoff model exists?

**HMAC-signed JWT-like tokens** — `lib/provider-lead-access.ts`:

- `createProviderLeadAccessToken()` — `lib/provider-lead-access.ts:100` — produces `base64url(payload).hmacSha256Sig`.
- Payload: `{ v:1, leadId, providerId, jobRequestId?, providerPhoneHash?, scopes[], jti, exp }`.
- TTL: 72 hours default (`TOKEN_TTL_MS = 72 * 60 * 60 * 1000` — `lib/provider-lead-access.ts:6`).
- Signing secret: `PROVIDER_LEAD_ACCESS_SECRET` → fallback chain `NEXTAUTH_SECRET` → `WHATSAPP_APP_SECRET` → `CRON_SECRET` — `lib/provider-lead-access.ts:57`.
- `verifyProviderLeadAccessToken()` — `lib/provider-lead-access.ts:127` — timing-safe comparison, returns `active | expired | invalid`.
- `resolveProviderLeadAccessToken()` — `lib/provider-lead-access.ts:238` — verifies signature, loads lead from DB, enforces: `lead.providerId === payload.providerId`, `provider.active`, `provider.status === 'ACTIVE'`, match not `CANCELLED`.

**Scope system** (`lib/provider-lead-access.ts:8`):
- `LEAD_RESPONSE_SCOPES`: `view_lead`, `accept_lead`, `decline_lead`.
- `ACCEPTED_JOB_SCOPES`: `view_job`, `confirm_arrival`, `mark_customer_contacted`, `mark_on_the_way`, `mark_arrived`, `start_job`, `complete_job`, `contact_customer`.

**Handoff redirect** — `lib/provider-pwa-handoff.ts:27`:
- `PROVIDER_PWA_HANDOFF_MAP` maps 10 events to PWA paths.
- `resolveProviderPwaHandoffPath()` uses token + lead status to decide between `/leads/access/[token]` and `/provider/jobs`.

**Deep-link entry points** (`app/provider/`):
- `/provider/handoff/[token]` — resolves token and redirects.
- `/provider/lead/[token]` and `/provider/job/[token]` — aliases for backwards compat.
- `/provider/jobs/[jobId]/handover` — full validation with expired/invalid error states and "Send me a new link" self-service form.

**Privacy gate in `resolveProviderLeadAccessToken()`** — `lib/provider-lead-access.ts:317`:
- Non-unlocked leads: description truncated to 180 chars via `previewNotes()` — `lib/provider-lead-detail.ts:106`; `customer: null`; address: suburb/city only.
- Unlocked leads (`lead.status === 'ACCEPTED' && lead.unlock.providerId === lead.providerId`): second DB query fetches `customer.name`, `customer.phone`, full `address`, all attachments.

---

### Q14. Where are privacy rules enforced?

**1. Opportunity preview** — `lib/provider-credit-copy.ts:310` (`buildProviderLeadPreviewMessage`): body contains only category, area (suburb/city), preferred time, urgency, photo count. No customer name/phone/address.

**2. Signed token scope** — `lib/provider-lead-access.ts:317` (`resolveProviderLeadAccessToken`):
- Before unlock: `description` truncated to 180 chars, `customer: null`, address = suburb+city only.
- After unlock (accepted + credit debited): full address, full description, customer name and phone.

**3. Lead detail service** — `lib/provider-lead-detail.ts:194` (`getProviderLeadDetailForProvider`):
- `isUnlocked` = `lead.status === 'ACCEPTED' && lead.unlock.providerId === providerId`.
- `unlockedDetails` including `customerName`, `customerPhone`, `whatsappHref`, `fullAddress`, `accessNotes` are only populated when `isUnlocked === true`.
- `whatsappHref` (`https://wa.me/...`) is only exposed post-unlock.

**4. WhatsApp acceptance notification** — `lib/selected-provider-acceptance.ts:388`:
- Full address and customer phone sent inline ONLY after the credit debit transaction succeeds.

**5. WhatsApp policy gate** — `lib/whatsapp-policy.ts:26` (`canSend`):
- UTILITY templates: blocked if `customer.whatsappServiceOptIn === false`.
- MARKETING templates: blocked if `whatsappMarketingOptIn === false` for customer or provider.
- Provider messages currently bypass the opt-in check (provider's `whatsappMarketingOptIn` field is used for marketing templates only; service/operational messages are not currently gated on a provider-service opt-in field).

**6. Webhook signature** — `app/api/webhooks/whatsapp/route.ts:41`: `verifyMetaSignature()` blocks non-Meta payloads before any data is touched.

**Gap**: `lib/whatsapp-policy.ts` opt-out path (`applyOptOut`) only handles `Customer` records. No equivalent opt-out path for providers exists. Provider STOP handling in the bot is not surfaced in the policy module.

---

### Q15. What gaps block a WhatsApp-complete provider journey?

Based on the current implementation, the journey is largely functional end-to-end in WhatsApp. The following gaps exist:

| Gap | Description | File/location |
|---|---|---|
| **No provider opt-out in whatsapp-policy** | `applyOptOut` and `applyOptIn` operate on `Customer` only. Provider STOP messages are not persisted via `whatsapp-policy.ts`. | `lib/whatsapp-policy.ts:64` |
| **No provider-service opt-in gate** | `canSend()` checks `provider.whatsappMarketingOptIn` for MARKETING templates but there is no provider service-opt-in field checked for UTILITY/operational templates sent to providers. | `lib/whatsapp-policy.ts:26` |
| **Completion requires STARTED status — no path to STARTED via text if ARRIVED skipped** | `completeProviderJobFromWhatsApp()` enforces `status === 'STARTED'`. If a provider sends "complete" from `ARRIVED`, the bot returns an error asking them to reply `start` first. This is correct behaviour but providers may not know the required sequence. | `lib/provider-whatsapp-job-commands.ts:527` |
| **Job completion photo is optional but the bot flow for photo capture is not documented in-code** | `completeProviderJobFromWhatsApp()` accepts `attachmentId` but the bot orchestration of the photo-or-skip prompt is in `whatsapp-bot.ts` (large file) not yet fully traced. | `lib/provider-whatsapp-job-commands.ts:491` |
| **Token TTL is 72 h — no refresh flow in WhatsApp** | A provider who receives a job link and opens it after 72 h gets an "expired" error with a "Send me a new link" form at `/provider/jobs/[jobId]/handover`. The self-service form calls `sendFreshAcceptedJobLink()`. No proactive re-send via WhatsApp message exists for the expiry case. | `app/provider/jobs/[jobId]/handover/page.tsx:90` |
| **No provider-facing "top up credits" WhatsApp flow** | Credits can be checked in WhatsApp but topping up requires the PWA (`/provider/credits`). The bot sends a Worker Portal CTA but has no inline credit purchase flow. | `lib/provider-channel-responsibility.ts:147` |
| **Credit ledger history is PWA-only** | Full ledger history requires PWA. WhatsApp shows balance summary only. | `lib/provider-channel-responsibility.ts:147` |
| **Quotes and match negotiation flows are PWA-only** | `/provider/quotes/[matchId]` exists in the authenticated PWA but no WhatsApp path exists for quote management. | `app/(provider)/provider/quotes/` |
| **`whatsapp-bot.ts` size** | The main bot router is >39,000 tokens. Opportunity response, interest-capture, and completion-photo orchestration logic lives inside this file and is not yet fully extracted into named modules like `provider-whatsapp-interest-capture.ts` or `provider-whatsapp-job-commands.ts`. This creates a risk that new commands introduced in steps 4–12 will be buried in the file. | `lib/whatsapp-bot.ts` |
| **Provider onboarding does not yet capture high-risk proof via WhatsApp** | `docs/provider-onboarding-high-risk-proof.md` exists. Auto-approve skips `HIGH_RISK_CATEGORY` applications for manual ops review, but the WhatsApp capture flow for high-risk proof uploads (e.g. PIRB certificate) is not confirmed as present. | `app/api/cron/provider-auto-approve/route.ts:13` |

---

## Implementation completed
No product changes made. Assessment only.

## Files changed
None

## WhatsApp flow changes
None

## PWA route/screen changes
None

## API/server changes
None

## Credit impact
None

## Security/privacy impact

Privacy rules are enforced at four layers:

1. **Opportunity preview** — `lib/provider-credit-copy.ts:310` — no PII in preview message.
2. **Token scope + DB check** — `lib/provider-lead-access.ts:317` — customer PII locked behind `isUnlocked` gate; full address and phone only after credit debit confirmed.
3. **Lead detail service** — `lib/provider-lead-detail.ts:194` — `unlockedDetails` populated only when `lead.status === 'ACCEPTED' && providerOwnsUnlock`.
4. **WhatsApp webhook** — `app/api/webhooks/whatsapp/route.ts:41` — HMAC signature verified before any payload is processed.

**Gap**: no provider-facing WhatsApp opt-out is wired through `lib/whatsapp-policy.ts`. Provider STOP keyword handling should be traced in `lib/whatsapp-bot.ts` to confirm it is handled at all.

## Tests added or updated
None

## Commands run
```bash
# none
```

## Test results
N/A

## Manual verification checklist
- [ ] Provider can complete required step in WhatsApp
- [ ] PWA remains optional
- [ ] Privacy rules are respected (customer PII gated behind credit unlock)
- [ ] Credit rules are respected (1 credit debited on selected-job acceptance, promo first)
- [ ] WhatsApp response is clear and uses CTA buttons for URLs (no raw URLs in body)

## Risks and follow-ups

1. **`lib/whatsapp-bot.ts` oversize** — All inbound routing still converges on a single 39k-token file. Any new WhatsApp commands added in steps 4–12 risk becoming buried. Steps should extract logic into named modules and keep `whatsapp-bot.ts` as a thin router.

2. **Provider opt-out gap** — `lib/whatsapp-policy.ts` has no provider STOP/opt-out path. Before adding more operational provider messages, the runner should wire a `applyProviderOptOut()` path.

3. **Photo capture orchestration not extracted** — The completion photo-or-skip prompt is orchestrated in `whatsapp-bot.ts`. Step 12 (completion flow) should extract this into `provider-whatsapp-job-commands.ts` or a new `provider-whatsapp-completion.ts`.

4. **Token refresh gap** — 72-hour token TTL with a manual "Send me a new link" self-service form at the PWA error page. A proactive WhatsApp re-send on near-expiry may be needed for providers who do not check the PWA.

5. **High-risk onboarding proof** — WhatsApp capture of high-risk category proof documents (PIRB certificates etc.) needs tracing in `lib/whatsapp-flows/registration.ts` before step 4 is executed.

6. **Quotes and match negotiation** — No WhatsApp path for quote management. This is out of scope for the current blueprint but should be flagged as a known gap in the channel responsibility model (step 2).

## OpenBrain note

The provider WhatsApp + PWA journey is substantially complete for the core 12 actions. The architecture is well-separated: `lib/provider-whatsapp-command-model.ts` owns command routing, `lib/provider-whatsapp-job-commands.ts` owns text-command execution, `lib/provider-whatsapp-interest-capture.ts` owns free-text interest parsing, `lib/provider-channel-responsibility.ts` is the authoritative channel matrix, and `lib/provider-lead-access.ts` owns the HMAC token/privacy gate. Future steps should preserve this separation and avoid adding business logic to `lib/whatsapp-bot.ts` directly.
