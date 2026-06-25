# Pre-JHB-North acquisition-funnel fixes — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every leak that's blocking the West Rand customer funnel from converting, so JHB North launch scales success rather than failure. The launch gate is one verified end-to-end paid job from a Meta-attributed customer over a 24-hour window with attribution working.

**Architecture:** No new subsystems. The pre-existing funnel-observability work (PR #145, Tier 1), `crudAction()`, `WorkflowEvent`, feature flags, and the matching engine all stay. This plan **wires what's missing**, **fixes what's broken**, and **rebalances the ad creative** so the platform actually has customer demand to scale.

**Tech Stack:** Next.js 16 App Router, Prisma 6, Supabase Postgres, Meta WhatsApp Cloud API, Meta Ads, GA4, Vercel.

**Audit data (prod, 2026-06-10 → 2026-06-24):**
- 8 customer signups, 0 with attribution.
- 4 job requests, 0 paid.
- 1 cancelled JR cascaded through 8 providers — 0 acceptances finalised (1 lead status=ACCEPTED with `providerAcceptedAt=NULL`).
- 22 provider WhatsApp interactive-template sends FAILED with reason "Re-engagement message".
- `Lead.viewedAt` NULL on every lead in last 30 days.

## Global Constraints

- **JHB North launch gate**: at least one Meta-attributed customer → paid job → completed within 24h of a verified test funnel.
- **No schema drops or renames** in feature PRs (additive only — house rule).
- **Every customer-facing change ships behind a feature flag**; flips happen separately.
- **PR #145 (Tier 1 funnel observability) must merge before Phase B** — Phase B's verification depends on the WorkflowEvent stream firing in prod.
- **Don't expand to JHB North until Phase E gate passes.** No exceptions.

## File Structure

### Create

| Path | Responsibility |
|---|---|
| `field-service/scripts/audit-lead-template-policy.ts` | One-shot CLI to query each lead-related WhatsApp template's Meta approval state + category (UTILITY vs MARKETING) and flag re-engagement-window risks |
| `field-service/scripts/backfill-lead-viewed-at.ts` | One-shot to set `viewedAt = respondedAt` for historical `Lead` rows where status >= VIEWED but `viewedAt IS NULL`, for funnel-report continuity |
| `docs/marketing/2026-06-24-west-rand-customer-ad-creative.md` | Customer-facing ad creative brief (replaces the provider-recruitment creative currently live on WR-Broad-All) |
| `field-service/__tests__/lib/matching/lead-ttl-extension.test.ts` | Tests for the configurable TTL change in MATCHING_CONFIG |

### Modify

| Path | What changes |
|---|---|
| `field-service/lib/matching/dispatch.ts` | Stop sending `interactive:new_lead_available` / `interactive:lead_expired` / `dispatch:job_lead_actions` — they fail outside the 24h session window. Move action buttons inline into the UTILITY template parameters (the same templates that DO deliver: `provider_lead_offer` / `quick_match_provider_lead_offer`) OR fall back to a deep-link CTA that opens the PWA |
| `field-service/lib/messaging-templates.ts` | Reclassify the `interactive:*` lead templates as UTILITY or remove them. Document each template's Meta approval state. |
| `field-service/lib/matching/config.ts` | Raise `offerTtlMinutes` from 15 to 60 (one hour). Sub-15-min TTL is too aggressive for WhatsApp response patterns. Provider acceptance test data shows the system is auto-timing-out everyone. |
| `field-service/app/leads/access/[token]/page.tsx` | Already partially fixed in PR #145 (writes `viewedAt`) — verify the write actually reaches prod (Layer-1 fix is meaningless if the page never runs because providers don't tap the link) |
| `field-service/lib/selected-provider-acceptance.ts` | Investigate the `providerAcceptedAt = NULL` while `status = ACCEPTED` half-commit shown by Vigilance Chauke's lead. Either fix the missing timestamp or surface a clear error if the credit gate blocks mid-flow. |
| `field-service/scripts/seed-flags.ts` | Add `admin.reports.customer_funnel = true` to the seed defaults so Phase D's data is visible to ops without a manual flip |
| `field-service/lib/provider-wallet-notifications.ts` | When `paidCreditBalance + promoCreditBalance < 1` for a provider who is currently in the dispatch pool, send a top-up nudge before they receive a lead they can't accept |

---

## Phase A — Confirm the ad-side leak (no code, 1–2 hours)

### Task A1: Pull Meta Ads insights for WR-Broad-All

**Files:** none (operational — uses memory `reference_meta_ads_api` for token + ad account `1349941660531643`)

**Why first:** Everything downstream depends on whether ads are actually generating traffic. If WR-Broad-All has 200+ link clicks but only 8 platform signups, Phase B's attribution work is critical. If clicks ≈ 8, the campaign needs creative + budget work before any code matters.

- [ ] Pull last 14 days of campaign-level insights: impressions, reach, link clicks, link CTR, landing-page-views (LPV), cost per LPV.
- [ ] Pull the same metrics for the alternative ad set (if any).
- [ ] Compare LPV count to 8 customer signups. Compute Drop ratio = (LPV − signups) / LPV.
- [ ] Confirm the destination URL of the active creative includes UTM params. If not — that's the root cause of zero attribution; fix in Task B1.

### Task A2: Confirm the creative is customer-shaped, not provider-shaped

- [ ] Open Meta Ads Manager → WR-Broad-All → preview the active creative.
- [ ] Check headline, primary text, CTA button, and destination URL. If the message is about "earn money", "be a service provider", or links to `/provider/signup` — this matches the prior session memory `project_funnel_finding_20260619` and explains why providers dominate the platform's WhatsApp traffic.
- [ ] If creative is provider-shaped: pause it. Replace with the customer-shaped creative drafted in Task A3.

### Task A3: Draft customer-shaped ad creative brief

**Files:**
- Create: `docs/marketing/2026-06-24-west-rand-customer-ad-creative.md`

- [ ] Headline: customer pain point (e.g. "Geyser leak. We have someone in 30 mins.")
- [ ] Destination URL: `https://app.plugapro.co.za/book/plumbing?utm_source=meta&utm_medium=cpc&utm_campaign=wr-broad-all-customer-v1&utm_content=geyser-leak-emergency`
- [ ] CTA button: "Book now"
- [ ] Audience: West Rand, 30–55, interests "home maintenance" / "geyser repair" / "plumbing"
- [ ] Budget: R150/day for 14 days (so daily report sample is statistically meaningful)
- [ ] Per OpenBrain memory `feedback_ad_publishing`: send visual ad previews for approval before publishing — even paused.

---

## Phase B — Attribution wired end-to-end (1 day, blocks Phase E)

### Task B1: Merge PR #145

- [ ] Resolve CI / review notes on PR #145 (Tier 1 funnel observability).
- [ ] Merge to main.
- [ ] Vercel auto-deploys to prod.
- [ ] Apply both migrations to prod (additive, safe — same Supabase Management API path as Slice B).

### Task B2: Verify the attribution capture writes `firstTouchSource` on a real ad click

- [ ] From a phone (incognito), click the new ad creative.
- [ ] Land on `/book/plumbing` with the UTM query string.
- [ ] Open DevTools → Application → Local Storage. Confirm `pap_attribution_first_touch` JSON has `utm_source: 'meta'`.
- [ ] Sign up + submit a request.
- [ ] Query prod: `select "firstTouchSource", "firstTouchCampaign", "firstTouchLandingPath" from customers where "createdAt" > now() - interval '10 minutes' order by "createdAt" desc limit 5;`
- [ ] All three columns must be populated. If null — the `AttributionCapture` component isn't mounting (check `field-service/components/attribution-capture.tsx` + root layout).

### Task B3: Confirm `WorkflowEvent.REQUEST_SUBMITTED` row appears in prod

- [ ] After Task B2's signup → submit, query `select * from workflow_events where "eventType" = 'REQUEST_SUBMITTED' and "occurredAt" > now() - interval '10 minutes';`
- [ ] If row present: the Tier 1 instrumentation is live.
- [ ] If absent: `lib/job-requests/create-job-request.ts` post-tx emit failed silently — check the recorder import and the post-tx hook path.

### Task B4: Flip the funnel admin flag

- [ ] In prod feature_flags table: `update feature_flags set enabled = true where key = 'admin.reports.customer_funnel';` (one-time; or merge `seed-flags.ts` change so it ships from code).
- [ ] Verify `/admin/reports/funnel` renders for an admin user.

---

## Phase C — Provider acceptance fixes (3–4 days; the hardest part)

### Task C1: Stop using `interactive:*` lead templates (Layer 2 fix)

**Files:**
- Modify: `field-service/lib/matching/dispatch.ts`
- Modify: `field-service/lib/messaging-templates.ts`
- Create: `field-service/scripts/audit-lead-template-policy.ts`

**Why:** Production data shows 22 sends FAILED in 14 days with reason "Re-engagement message". Meta rejects these because the templates are MARKETING-category or unapproved and the provider hasn't messaged us in 24h. The UTILITY-category templates (`provider_lead_offer`, `quick_match_provider_lead_offer`) DO deliver (5 + 4 reads each).

- [ ] **Step 1:** Write `audit-lead-template-policy.ts` that prints each template name's Meta approval category. The Meta Graph API endpoint is `/v18.0/{whatsapp-business-account-id}/message_templates`.
- [ ] **Step 2:** Run it; flag every template that fires from dispatch with category != UTILITY.
- [ ] **Step 3:** In `dispatch.ts`, change the action-buttons send to use a UTILITY-category template that ships the "Accept" / "Decline" CTAs as quick-reply buttons in the *same* approved template (don't fire two messages, one of which fails). If Meta won't approve a single template with both content + buttons, fall back to a deep-link button that opens the PWA at `/leads/access/[token]` — no second WhatsApp message needed.
- [ ] **Step 4:** Update the failing-message-event logging to include the resolved template policy decision (UTILITY / session-window / blocked) so future debugging doesn't need DB spelunking.
- [ ] **Step 5:** Tests: assert that on a fresh provider with no inbound session in 24h, the dispatch flow still produces a deliverable message.

### Task C2: Raise lead TTL from 15 min to 60 min (Layer 4 fix)

**Files:**
- Modify: `field-service/lib/matching/config.ts`
- Create: `field-service/__tests__/lib/matching/lead-ttl-extension.test.ts`

**Why:** Of 8 leads to the cancelled JR, 6 had `respondedAt` set exactly 15 minutes after `sentAt` — the cron auto-timed them out. A plumber on a job can't respond in 15 minutes. The 1 lead that DID get accepted had a 1-minute response, so motivated providers respond fast — but the median honest response is hours, not minutes.

- [ ] **Step 1:** Change `MATCHING_CONFIG.offerTtlMinutes` from 15 → 60.
- [ ] **Step 2:** Verify the cron at `app/api/cron/match-leads/route.ts` reads from this constant.
- [ ] **Step 3:** Add a regression test that proves a 30-min-old lead is NOT expired when TTL = 60.
- [ ] **Step 4:** Document the tradeoff: longer TTL means slower fallback to the next provider when one ignores. Acceptable while supply is being built.

### Task C3: Fix the `providerAcceptedAt = NULL` half-commit (Layer 3 fix)

**Files:**
- Modify: `field-service/lib/selected-provider-acceptance.ts`
- Create: `field-service/__tests__/lib/selected-provider-acceptance-half-commit.test.ts`

**Why:** Vigilance Chauke's lead has `status = 'ACCEPTED'` but `providerAcceptedAt = NULL`. The transaction set status but didn't stamp the timestamp. Either the column write was forgotten or the credit gate failed mid-flow and the rollback was partial.

- [ ] **Step 1:** Read `acceptSelectedProviderJob` in `lib/selected-provider-acceptance.ts`. Locate the `lead.update({ data: { status: 'ACCEPTED'} })` call.
- [ ] **Step 2:** If the update doesn't include `providerAcceptedAt: new Date()`, add it. The pattern is: status flip and timestamp ALWAYS travel together.
- [ ] **Step 3:** Audit every other `Lead.status = 'X'` write site for paired timestamps: `viewedAt` when VIEWED, `declinedAt` when DECLINED, `expiredAt` when EXPIRED, `providerAcceptedAt` when ACCEPTED.
- [ ] **Step 4:** Run the backfill in Task C5 to repair historical rows.

### Task C4: Provider credit nudge before zero-balance dispatch

**Files:**
- Modify: `field-service/lib/provider-wallet-notifications.ts`

**Why:** 14 active providers have 0 credits. 70 providers have exactly 1 promo credit. Sending these providers a lead they can't accept (and not telling them why) wastes leads + erodes provider trust.

- [ ] **Step 1:** In the wallet-notifications module, add `notifyProviderInsufficientCreditsForUpcomingLead(providerId)` that fires when balance crosses below 2.
- [ ] **Step 2:** Hook the trigger to the daily provider-funnel cron so notifications happen out-of-band of dispatch (don't add latency to the hot path).
- [ ] **Step 3:** Confirm the UTILITY-category top-up template (e.g. `provider_credit_low_topup`) exists in `messaging-templates.ts`. If not, draft it for Meta approval.
- [ ] **Step 4:** Document the threshold (2 credits) and adjust based on observed daily lead arrival rate.

### Task C5: Backfill `Lead.viewedAt` for historical rows

**Files:**
- Create: `field-service/scripts/backfill-lead-viewed-at.ts`

**Why:** Funnel reports use `viewedAt` as the "provider opened the lead" signal. Today every historical row has it null. Without a backfill the funnel will look like zero-viewing forever.

- [ ] **Step 1:** Identify the safe-source: for leads with `status IN ('VIEWED', 'INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'ACCEPTED_LOCKED', 'ACCEPTED', 'DECLINED')` and `viewedAt IS NULL`, use `respondedAt` as a proxy (since the provider had to view before responding).
- [ ] **Step 2:** Run as a dry-run first; show the count of rows that would be updated.
- [ ] **Step 3:** Apply. Idempotent: skips rows where `viewedAt` is already set.
- [ ] **Step 4:** After backfill, verify funnel-report's `Provider viewed` count is non-zero.

---

## Phase D — Customer-flow drop investigation (1 day; depends on Phase B)

### Task D1: Walk the customer flow from a fresh phone

**Files:** none (operational)

**Why:** 6 of 8 signups in the last 14 days never submitted a request. We need to know WHERE they dropped. After PR #145 merges + 24h of data, the funnel page tells us this from `WorkflowEvent` REQUEST_STARTED vs REQUEST_SUBMITTED gap. Pre-merge, do it manually.

- [ ] Open the ad's destination URL in a fresh incognito session.
- [ ] Try to submit a service request as a brand-new customer.
- [ ] Note every screen that requires action (OTP, KYC, terms, photos).
- [ ] Time each step. If any step takes > 30 seconds for a motivated customer, that's a friction candidate.
- [ ] Compare to memory `project_funnel_finding_20260619`: "ad creative is provider-targeted, mid-flow drop is 100%".

### Task D2: Identify and gate any auth-before-submit requirement

**Files:** TBD based on Task D1

**Why:** If customers are forced to OTP / sign up BEFORE seeing the submit form, that's the leak. The customer should be able to fill out the request, see a quote, THEN sign up to confirm.

- [ ] In `field-service/components/customer/BookingFlow.tsx`, identify steps that gate on `session`.
- [ ] If submit requires auth and there's no path to "describe your problem first, sign up after" — flag for design discussion. This is a product call, not a code call.

---

## Phase E — Launch gate verification (24h window before JHB North)

### Task E1: One verified end-to-end paid job

**Files:** none (operational gate)

- [ ] Spend R150 on the new customer-shaped ad creative for 24h.
- [ ] Confirm in prod:
  - [ ] At least one `customers` row with `firstTouchSource = 'meta'` in the 24h.
  - [ ] At least one matching `JobRequest` with the same UTM stamped.
  - [ ] At least one matching `WorkflowEvent` REQUEST_SUBMITTED.
  - [ ] At least one matching `WorkflowEvent` PROVIDER_NOTIFIED with `metadata->>'delivered' = 'true'`.
  - [ ] At least one matching `WorkflowEvent` PROVIDER_ACCEPTED.
  - [ ] At least one matching `WorkflowEvent` CLIENT_NOTIFIED.
  - [ ] The matching `Booking.status = 'COMPLETED'` and `Payment.status = 'PAID'`.
- [ ] If ALL of the above pass: green-light JHB North.
- [ ] If ANY step fails: identify the failing layer using `/admin/reports/funnel` + the daily script; fix it; re-test.

### Task E2: 30-day post-launch monitoring plan

**Files:** none

- [ ] Run `pnpm tsx scripts/daily-customer-funnel-report.ts` every morning, 07:00 SAST.
- [ ] Add the daily output to OpenBrain via a hook in the script.
- [ ] If any of these alarms trip: pause new ad spend until investigated:
  - Daily customers > 10 with `firstTouchSource = NULL` (attribution regression)
  - Daily job requests submitted > 0 but eligible providers = 0 (no supply)
  - PROVIDER_NOTIFIED → PROVIDER_ACCEPTED rate < 30% (back to the Phase C failure mode)
  - CLIENT_NOTIFIED → PAYMENT_SUCCESS rate < 50%

---

## Risks + assumptions

| Risk | Mitigation |
|---|---|
| Meta won't approve a UTILITY template with embedded action buttons (Task C1) | Fallback: ship a deep-link button in the existing approved template that opens the PWA's `/leads/access/[token]` — provider taps once, sees the lead, taps Accept/Decline in the PWA (web) instead of WhatsApp |
| Provider supply in West Rand is too thin for the 60-min TTL (Task C2) — slower fallback may cause more requests to time out without any provider accepting | Monitor JR.status transitions for 7 days post-launch; if MATCH_NO_PROVIDER_AVAILABLE goes up, reduce TTL back to 30 min and grow supply first |
| Customer-shaped ad creative underperforms the provider-shaped one (Task A3) — customers may be a thinner audience to acquire | Acceptable — we're optimising for the right funnel direction, not raw click volume |
| Half-commit fix (Task C3) reveals other status/timestamp pairs are also broken | Audit + fix as found; this is normal regression work |
| 60-min TTL exposes new race conditions in the dispatch cron | Test in preview before prod; the existing cron pickup interval is 5 min during peak — increasing TTL just expands the window for the existing logic |

## Out of scope (explicit)

- Tier 2 funnel observability (`VisitSession`, `PaymentStatusEvent`, INSUFFICIENT_CREDIT as filter exclusion)
- Multi-language UI (Portuguese landed 2026-06-17 — see memory `project_localisation_backlog_20260619`)
- Provider recruitment campaigns (we have 108 active providers; provider-side onboarding is not the bottleneck)
- Pricing changes
- New service categories

## Acceptance — what changes when this is shipped

| Today | After this plan |
|---|---|
| 0/8 customer signups attributed | Every customer from the new ad has `firstTouchSource` stamped |
| 75% customer-signup → request drop | < 50% drop (Task D2 may surface code change; product call may follow) |
| 0/8 leads viewed in DB (column unwritten) | All ACCEPTED / DECLINED leads have `viewedAt` populated |
| 22 lead-template sends FAILED with "Re-engagement message" | 0 failures from policy block; remaining failures are real WhatsApp delivery issues |
| 15-min lead TTL → cron auto-times-out everyone | 60-min TTL gives providers a fair window |
| Vigilance Chauke half-commit (`status=ACCEPTED`, `providerAcceptedAt=NULL`) | Acceptance is atomic + timestamped, or it errors clearly |
| 14 providers in dispatch pool with 0 credits | Pre-emptive top-up nudge fires; pool reflects accept-capable providers |
| No visibility into where customers drop | `/admin/reports/funnel` shows stage-by-stage drop for any date range |

## OpenBrain log

After implementation, add knowledge entry:

- Title: `engineering — Pre-JHB-North acquisition fixes shipped (YYYY-MM-DD)`
- Domain: `engineering`
- Tags: `pre-launch`, `funnel`, `provider-acceptance`, `whatsapp-templates`, `lead-ttl`
- Content: this plan's §Phase summaries + the actual numbers post-launch verification produced.
