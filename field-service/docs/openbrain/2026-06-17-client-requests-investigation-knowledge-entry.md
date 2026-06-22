# OpenBrain knowledge entry — replay this when CLI is reachable

Project: Plug-A-Pro
Domain: improvement
Title: investigation — client service requests audit + manual-match queue (2026-06-17)
Tags: matching, communication, ops, west-rand, pilot, audit, whatsapp-24h-window, post-match-notification

## Content

**Scope:** Comb through every client/customer service request to date.

**Real client touchpoints found (22 in total):**
- 3 completed JobRequests (1 MATCHED today but customer NEVER notified; 2 EXPIRED)
- 7 service_area_waitlist entries (4 with zero outbound after initial plain-text reply)
- 12 stuck job_request conversations (all 12 invisible to admin — no customers row was created)
- + 315 distinct phones in inbound_whatsapp_messages that are neither customer nor provider (funnel-top tracking is broken)

**The 3 real JobRequests:**

| ID | Customer | Service | Suburb | Status | Issue |
|---|---|---|---|---|---|
| `cmpwxgjwv0012jv04pjuuikdx` | +27726588278 (Test user?) | Appliances (TitleCase bug) | Honeydew | EXPIRED 2026-06-09 | 546 STRUCTURAL retries during KYC-block; 141 FAILED Re-engagement messages |
| `cmqf77w0o002nl404e35wyhkp` | +27686819941 **Ishmael** (name backfilled 2026-06-17 from inbound) | Handyman | Honeydew | MATCHED today 07:46 by Vigilance Chauke | **Customer not told** — `post_match_customer_provider_accepted` FAILED Re-engagement |
| `cmqffbtol00b3jv04njepz6tc` | +27680805333 (Andries) | Garden & Landscaping | Honeydew | EXPIRED today 07:01 | Only 1 garden-approved provider in pilot (Donald Bhunu) — didn't accept |

**Top operational failures (in priority order):**
1. **Post-match customer notification fails outside 24h WhatsApp window.** `post_match_customer_provider_accepted` is sent as an interactive message, not via `sendTemplate`. Real consequence today: Ishmael doesn't know he was matched. Fix path: register the post-match notice as approved Meta MARKETING template + reroute via `sendTemplate`.
2. **Customer name capture is broken.** All non-Andries customers have name="WhatsApp Customer". Conversation `data` has `addressLine1`, `category`, `urgency` but NO `name` field. Backfilled JR-B → "Ishmael" from inbound; JR-A typed "Test user" so left as-is.
3. **Category case-normalisation bug.** JR-A category stored as `Appliances` (TitleCase) while `provider_categories.categorySlug` uses `appliances` (lowercase). Pre-filter mismatch on top of the historical KYC-block.
4. **Single-provider supply for garden (1) + zero plumbing (0)** in West Rand pilot. Garden failures will repeat. Plumbing requests will always expire.
5. **12 mid-flow customers never created in `customers`.** 100% invisibility for stuck conversations. The 4 newest are recoverable within today's 24h window.
6. **`service_area_waitlist` has no admin UI.** 7 rows, 4 received zero follow-up since signup. The latest (WL-7, today 02:00) has had no acknowledgement at all.
7. **Dispatch case stays OPEN after MATCH** (case `cmqf77wlp002ol404tu0bb4vy` still OPEN for the MATCHED Ishmael request).
8. **No admin UI to compose a one-off customer follow-up message.** Server action `sendAdminWhatsappAction` exists (flag-gated `admin.messages.outbound`, audit-logged) but is not surfaced on `/admin/messages`.

**Pilot supply (West Rand active) — approved-category counts:**
- handyman: 18, painting: 13, cleaning: 10, carpentry: 10, appliances: 10, diy: 9, tiling: 7, plastering: 6, rhinoliting: 4, **garden: 1**, **plumbing: 0**

**KYC posture in pilot:** 4 VERIFIED, 1 IN_PROGRESS, 50 NOT_STARTED (grace flag covers pre-2026-06-11 cohort).

**Actions taken in this session:**
- Investigation only (analysis + safe report writing). No source code modified.
- One DB write: `update customers set name='Ishmael' where id='cmqf77upu002hl4046s0c1ew3'` with audit_logs row (`CUSTOMER_NAME_BACKFILL`).
- Report written: `field-service/docs/openbrain/2026-06-17-client-requests-investigation.md`
- Follow-up queue written: `field-service/docs/openbrain/2026-06-17-client-followup-queue.md`
- This knowledge entry: `field-service/docs/openbrain/2026-06-17-client-requests-investigation-knowledge-entry.md`

**What still needs manual operator review (today):**
1. Reach Ishmael (+27686819941) — outside 24h, send via personal WhatsApp or approved template; close case `cmqf77wlp002ol404tu0bb4vy`; set match.customerContactedAt
2. Reach Andries (+27680805333) — confirm if still needed; retry Donald Bhunu or push to Tshenolo Mogatosi
3. Send waitlist acknowledgement to +27746255114 (still in 24h window), +27785982935, +27655405077
4. Nudge STK-4 (+27788695657) — addr_confirm step today, one tap from submitting

**Engineering follow-ups (this week):**
- Fix customer-name persistence in `field-service/lib/whatsapp-flows/job-request.ts` (collect_name → customers.name)
- Force category lowercase at WA flow submit + at dispatch read
- Register `post_match_customer_provider_accepted` as approved Meta MARKETING template
- Add pre-send 24h-window helper; switch to template when outside

**Decisions deferred to user:**
- Whether to add `/admin/waitlist` + `/admin/conversations/stuck` admin pages
- Whether to expose `sendAdminWhatsappAction` as a compose UI on `/admin/messages`
- Whether to action a read-only `field-service/scripts/client-requests-report.ts`

**Risks / follow-up items:**
- JR-A may be a real customer or a test. Treatment as cold re-engage assumes "test user" but isTestRequest=false. If user wants to treat as real, recreate JR with `category=appliances`.
- The match for Ishmael is real but unbookable until customer is contacted; provider Vigilance Chauke also doesn't yet know whether the customer can reach him.

## Replay command (once OpenBrain reachable)

```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend" && pnpm brain -- knowledge add \
  --project "Plug-A-Pro" \
  --domain "improvement" \
  --title "investigation — client service requests audit + manual-match queue (2026-06-17)" \
  --tags "matching, communication, ops, west-rand, pilot, audit, whatsapp-24h-window, post-match-notification" \
  --content "$(cat field-service/docs/openbrain/2026-06-17-client-requests-investigation-knowledge-entry.md)"
```
