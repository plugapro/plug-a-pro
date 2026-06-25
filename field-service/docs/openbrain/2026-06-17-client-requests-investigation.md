# Plug A Pro — Client Service Requests Investigation
**Date:** 2026-06-17
**Scope:** All client/customer service requests on the platform to date
**Mode:** Analysis only (read-only DB queries + code inspection). No code changes made.
**Pilot region:** West Rand / Roodepoort (`jhb_west`)

---

## 1. Executive summary

The platform has handled very low real volume to date, and almost every real client has hit at least one operational failure. Volume is not the issue; the funnel is leaking at four distinct points.

| Surface | Real clients | Notes |
|---|---|---|
| Completed `JobRequest` (real, not test) | **3** | 1 MATCHED (today, 11h ago, customer never told), 2 EXPIRED |
| `service_area_waitlist` (real) | **7** | 4 received zero follow-up; latest joined ~16h ago, no reply |
| Stuck `job_request` conversations (real, never completed) | **12** | None became `customers`, none reachable from admin UI |
| Inbound WA phones not in `customers` or `providers` | **315** | All-time funnel-top, no triage surface |
| **Total real distinct phones that engaged but never got served** | **~24** | Waitlist + stuck flow + matched-but-uncontacted |

Where they got stuck (in operational priority order):

1. **Post-match notification failure (URGENT, today).** The 1 MATCHED customer (`+27686819941`, handyman, Honeydew) has not been told a provider accepted — `post_match_customer_provider_accepted` failed with `Re-engagement message`. The dispatch case is still `OPEN`, unassigned.
2. **Andries (`+27680805333`, garden, Honeydew) — EXPIRED today.** Only 1 garden-approved provider in pilot (Donald Bhunu) — they didn't accept. Customer was told "no match" via interactive message; no manual outreach yet.
3. **No provider supply for "garden" or "plumbing" in pilot.** 1 approved garden provider, 0 approved plumbing providers — any future request in those categories will fail the same way.
4. **Notification storm + 24h-window mis-use.** Customer `+27726588278` (Honeydew Appliances, June 2) received **141 FAILED** `interactive:quick_match_progress_update` sends after their 24h WhatsApp window closed. These are non-template interactive messages used outside the policy window. (Symptom of the historical KYC-block retry storm already documented.)
5. **Waitlist clients are a dead-end.** 7 waitlist entries since 2026-06-11; 4 have had zero outbound after the initial plain-text "not in your area" message. No "we now serve you" hook exists for waitlist.
6. **12 conversations stuck mid-flow** (`browse_categories`, `collect_issue_description`, `addr_confirm`). None visible to admin (no Customer/JobRequest row created until completion).

| Stat | Count |
|---|---|
| Total real client touches reviewed | 22 (3 JR + 7 waitlist + 12 stuck) + 315 unknown-phone funnel-top |
| Open / unresolved real touches | 17 (1 MATCHED-not-notified, 1 EXPIRED, 7 waitlist, 12 stuck — overlap with waitlist where same phone re-engaged) |
| Completed / closed positively | 0 (never had a single completed job) |
| Stuck — partial data (browse / address / description) | 12 |
| Needs client clarification | 0 of the 3 JRs (all have category + suburb + phone) |
| With NO customer-facing communication | 4 of 7 waitlist entries |
| Manually matchable now | 1 (Andries, garden — Donald Bhunu still the only candidate) |
| Blocked by no provider supply (category/area) | 1 (garden) + future plumbing requests |
| Blocked by product/system issue | 2 (post-match Re-engagement; 24h-window mis-use) |

---

## 2. Request breakdown table

| # | Request ID / waitlist ID / conv ID | Customer (phone) | Service | Suburb | Created | Current status | Data quality | Comm status | Match status | Recommended next action |
|---|---|---|---|---|---|---|---|---|---|---|
| **JR-A** | `cmpwxgjwv0012jv04pjuuikdx` | "WhatsApp Customer" `+27726588278` | Appliances | Honeydew | 2026-06-02 17:44 | `EXPIRED` | Complete; name missing | Customer notified "no match" (2026-06-09 18:00). 141 FAILED progress updates after window closed. Last READ ack: 2026-06-03 03:30 | 0 leads ever; 546 STRUCTURAL/KYC_NOT_VERIFIED dispatch retries; resolved historically by KYC grace flag | Manual apology + re-offer: 10 approved appliances providers now in pilot. Confirm if customer still needs help; if yes, recreate request as `category:appliances` (lowercase) and force-assign. Template: `slot_available` (MARKETING). |
| **JR-B** | `cmqf77w0o002nl404e35wyhkp` | "WhatsApp Customer" `+27686819941` | Handyman | Honeydew | 2026-06-15 12:37 | `MATCHED` (today 07:46) | Complete; name missing | **CUSTOMER NEVER TOLD.** `post_match_customer_provider_accepted` FAILED Re-engagement. 24h-window failed. Last READ ack: 2026-06-15 14:20. | Match accepted by Vigilance Chauke (`+27787089063`) at 07:46 today, 8 prior leads cycled (EXPIRED/CANCELLED), no booking yet | **URGENT.** Notify customer via MARKETING template + manually connect to Vigilance. Close dispatch case `cmqf77wlp002ol404tu0bb4vy`. |
| **JR-C** | `cmqffbtol00b3jv04njepz6tc` | Andries `+27680805333` | Garden | Honeydew | 2026-06-15 16:24 | `EXPIRED` (today 07:01) | Complete + name | Told "matching in progress" 16:26, told "no match" 16:40 and 07:01 today. 2 Re-engagement FAILED in between. | 1 eligible (Donald Bhunu), 1 lead sent, EXPIRED unaccepted. Other 4 suburb-exact providers all `CATEGORY_NOT_APPROVED` for garden. | Manual outreach. Confirm if still needed. If yes, retry Donald + manually broaden category to handyman ("garden tidy-up" overlaps with handyman skill in practice). |
| **WL-1** | `cmq91tutj003si904f6iem5ji` (`cmq91p99o` conv stuck `collect_issue_description`) | `+27734320218` | handyman | "Gauteng - Other" | 2026-06-11 05:20 | waitlisted; conversation abandoned mid-flow | Phone only; no name, no suburb | Single outbound 2026-06-11 06:00, nothing since. 6+ days dark. | n/a (no JR) | Send "still need help?" UTILITY follow-up. If suburb is actually in pilot, route back into flow. |
| **WL-2** | `cmqaqzcfd001gl7049qgghrvu` (`cmqaqmun5` conv stuck `collect_issue_description`) | `+27655405077` | painting | "Outside Gauteng" | 2026-06-12 09:52 | waitlisted; conversation abandoned | Phone only | **ZERO outbound ever.** Has had no acknowledgement. | n/a | Send waitlist apology + "we will let you know when we expand". |
| **WL-3** | `cmqb8cnzi000ojr04spdr1yci` (`cmqb7yogn` conv — note flow=`registration`) | `+27718438266` | garden | Johannesburg | 2026-06-12 17:58 | waitlisted; phone ended up in PROVIDER signup flow | Phone only | 2 outbound up to 2026-06-12 18:09. | n/a | Investigate: did they want to be a provider or a customer? Re-engage and confirm intent. |
| **WL-4** | `cmqeua8430005l404apcpvmp0` | `+27785982935` | carpentry | Katlehong (East Rand, not pilot) | 2026-06-15 06:35 | waitlisted; conv idle | Phone only | **ZERO outbound ever.** | n/a | Send waitlist apology. Track for East Rand expansion. |
| **WL-5** | `cmqf70x5h000nl404vn1n91m5` (`cmqf6sb5g` conv idle) | `+27686819941` (= JR-B customer) | handyman | "Gauteng - Other" | 2026-06-15 12:32 | waitlisted, then 5 min later completed JR-B | n/a | n/a (covered by JR-B comms) | n/a | n/a — same person as JR-B. |
| **WL-6** | `cmqff20qe0098jv046zph8qgg` (`cmqfevp0j` conv idle) | `+27680805333` (= JR-C customer Andries) | garden | "Gauteng - Other" | 2026-06-15 16:17 | waitlisted, then 7 min later completed JR-C | n/a | n/a (covered by JR-C comms) | n/a | n/a — same person as JR-C. |
| **WL-7** | `cmqhfbq9w000hld04yet7cu3m` (`cmqhewzsy` conv idle) | `+27746255114` | painting | Johannesburg | 2026-06-17 02:00 | waitlisted, idle ~16h | Phone only | **ZERO outbound ever.** | n/a | Send waitlist apology + "we may have providers" (13 approved painting providers in pilot — verify their actual suburb before claiming). |
| **STK-1** | `cmqi6h7k1` | `+27640467733` | (browsing) | unknown | 2026-06-17 14:40 | stuck `collect_issue_description` (3h ago) | none | none | none | Light-touch nudge if still in 24h window. |
| **STK-2** | `cmqhy0f50` | `+27785904074` | (browsing) | unknown | 2026-06-17 10:43 | stuck `browse_categories` | none | none | none | UTILITY nudge "still browsing?" |
| **STK-3** | `cmqhxoc2j` | `+27697093971` | (browsing) | unknown | 2026-06-17 10:33 | stuck `browse_categories` | none | none | none | UTILITY nudge. |
| **STK-4** | `cmqhn06uv` | `+27788695657` | (chose category, gave address) | unknown | 2026-06-17 05:35 | stuck `addr_confirm` (one tap away from submitting) | partial | none | none | High-value recovery — they were one step from completing. Send "tap Confirm to submit". |
| **STK-5..STK-12** | 8 older sessions (2026-06-05 → 2026-06-14) | various | various | unknown | various | stuck — abandoned days/weeks ago | none | none | none | Cold; one-off "we'd love to help, restart here" with PWA URL. Low priority. |

Notes:
- The 3 real customers (JR-A, JR-B, JR-C) all have `name = "WhatsApp Customer"` except Andries. The customer-name capture in the WA flow does not appear to be wired through to the customer row.
- JR-A's category is stored as `Appliances` (TitleCase) but provider_categories uses `appliances` slug. This was identified previously and is a known case-normalisation bug that worsens supply for this request even after KYC grace.

---

## 3. Stuck journey analysis

Bottlenecks observed, ordered by impact:

1. **24-hour WhatsApp re-engagement policy is being violated by non-template interactive messages.** `interactive:quick_match_progress_update`, `interactive:quick_match_rotation`, and `post_match_customer_provider_accepted` are sent via `sendText`/`sendInteractive` (not `sendTemplate`). When >24h elapse since the customer's last inbound message, Meta returns "Re-engagement message" failure. Evidence:
   - JR-A: 141 FAILED `quick_match_progress_update` over 2026-06-03 → 2026-06-04
   - JR-B: `post_match_customer_provider_accepted` FAILED today 07:46 → **customer doesn't know they were matched**
   - JR-C: 2 FAILED `quick_match_progress_update` between the two no-match notifications
   - Fix path: ensure post-match notifications go via approved MARKETING/UTILITY templates (e.g. add `post_match_customer_provider_accepted` to messaging-templates.ts as MARKETING with URL button to PWA).

2. **Customer name not persisted from the WA flow.** All real JR customers except Andries have `name = "WhatsApp Customer"`. Either the flow never asks (job-request.ts has a `collect_name` step but it may be skipped) or the capture is dropped when creating the customer record. Ops sees nameless rows.

3. **Stuck conversations never become `customers`.** 12 mid-flow conversations exist (4 from today). All 12 phones have **no `customers` row** — so they are invisible to the entire admin surface. Loss rate from this funnel is effectively 100%.

4. **No admin surface for waitlist or stuck flows.** The `service_area_waitlist` and `conversations` tables have no admin UI. Ops cannot see "who tried to book and got stuck".

5. **Single-provider supply for garden + zero plumbing.** Donald Bhunu is the only approved garden provider in pilot. If he doesn't respond, the request expires. No plumbing supply at all. The platform shape (West-Rand-only pilot) is intentional, but recruiting drive must be category-balanced, not just headcount.

6. **Dispatch case stays OPEN after MATCH.** JR-B is `MATCHED` but its dispatch case (`cmqf77wlp002ol404tu0bb4vy`) is still `state=OPEN` with no owner. Either the case-close hook on match-success is missing, or it requires manual ops close — both result in stale work in the queue.

7. **No "no candidates → why?" surface for ops.** Ops can see "no match" but the `filterSummary` (KYC_NOT_VERIFIED, CATEGORY_NOT_APPROVED, etc.) is buried in the dispatch decision JSON. The admin dispatch page does surface this (good), but there's no per-request "this provider would have worked if X" recommendation.

8. **No "manual send WhatsApp follow-up to customer" UI.** `sendAdminWhatsappAction` exists at `field-service/app/(admin)/admin/messages/actions.ts` and is flag-gated (`admin.messages.outbound`) and audit-logged — but the messages page does not yet expose a "send" form. Today, ops can retry an existing failed message but cannot compose a new one.

9. **No "request status" view that filters by communication-failed.** The dispatch page filters by `OPEN|MATCHING` only. EXPIRED requests with failed comms (JR-A, JR-C) disappear from view — they're closed at the JobRequest level but ops still owes the customer a human follow-up.

---

## 4. Manual match recommendations

### JR-B (URGENT) — customer must be notified the match happened
- **Match:** Vigilance Chauke (`+27787089063`), accepted at 07:46 today
- **Action 1 (do today):** Manually notify customer `+27686819941` via approved MARKETING template. Draft message in §6.
- **Action 2:** Manually connect customer and provider (3-way WhatsApp link or share details with both) since the in-app post-match auto-notify failed.
- **Action 3:** Close case `cmqf77wlp002ol404tu0bb4vy` once customer confirms contact.

### JR-C (Andries, garden) — only one candidate, retry needed
**Recommended providers (best 3 within pilot supply constraints):**

| # | Provider | Phone | Category fit | Coverage | KYC | Risk / caveat |
|---|---|---|---|---|---|---|
| 1 | Donald Bhunu | `+27848774952` | Approved: cleaning, **garden**, handyman, painting, tiling | jhb_west | NOT_STARTED (grace-eligible) | Was the only eligible, didn't accept first lead. Re-prompt directly via ops. |
| 2 | Vigilance Chauke | `+27787089063` | Approved: handyman, painting, plastering, rhinoliting (NOT garden) | jhb_west | NOT_STARTED (grace-eligible) | Already matched on JR-B — likely double-booking risk; deprioritise unless capacity confirmed. |
| 3 | Tshenolo Mogatosi | `+27810642452` | Approved: carpentry, diy, handyman, painting, plastering, tiling (NOT garden) | jhb_west | NOT_STARTED (grace-eligible) | Strong category breadth; ops would need to ask if they handle garden tidy-ups (overlaps with handyman). |

**Operator action:** WhatsApp Donald first (lead already expired). If he can't, frame the work to Tshenolo as "handyman / outdoor tidy" — the customer's description is "trim my garden", which a handyman can typically do.

### JR-A (Honeydew Appliances, 2026-06-02) — only worth re-engaging if customer still wants help
**Recommended providers (top 3 appliances-approved in pilot):**

| # | Provider | Phone | Approved cats | KYC | Notes |
|---|---|---|---|---|---|
| 1 | Bernard Dembera | `+27738505434` | (categorySlug data missing — appears as "appliances" provider per historical record) | NOT_STARTED (grace) | Was the original eligible candidate filtered out as TEST_COHORT_MISMATCH. |
| 2 | Prince Charles Ncube | `+27735935473` | appliances, carpentry, cleaning, handyman, painting | **VERIFIED** | Best trust posture (KYC verified). |
| 3 | Cassian Makhura | `+27832624855` | appliances, handyman | NOT_STARTED (grace) | Good breadth, low complaint count. |

**Operator action:** Send apology + "still need help?" message. If yes, recreate request as new JR with `category=appliances` (lowercase) so the matching path doesn't trip the case-mismatch.

### Waitlist (WL-7, painting Joburg, today) — verify suburb in pilot first
- The waitlist row says "Gauteng - Other" — likely they picked a non-pilot suburb. If the suburb is actually in `jhb_west`, manually create a JR for them. 13 approved painting providers are in pilot.

---

## 5. Communication gap report

| Phone | Last meaningful outbound | Comm state | Manual follow-up needed |
|---|---|---|---|
| `+27686819941` (JR-B customer) | `post_match_customer_provider_accepted` FAILED Re-engagement, today 07:46 | **Critical: matched but not told** | Send approved-template apology + match notice |
| `+27680805333` (Andries, JR-C) | `interactive:job_request_no_match` SENT (not READ), today 07:01 | Knows it's "no match" but no apology / no human follow-up | Send personal apology + offer manual retry |
| `+27726588278` (JR-A) | `interactive:job_request_no_match` SENT (not READ), 2026-06-09 18:00 | 15 days dark, possibly disengaged | Cold re-engage with `slot_available` MARKETING template; only if they reply do we recreate the JR |
| `+27734320218` (WL-1) | 2026-06-11 06:00 | 6 days dark | Send "still looking?" UTILITY nudge (within 24h of any inbound; else MARKETING) |
| `+27655405077` (WL-2) | none ever | **No comm at all** | Apology + waitlist notice |
| `+27718438266` (WL-3) | 2026-06-12 18:09 | Probably entered provider flow by mistake | Clarify intent (customer vs provider) |
| `+27785982935` (WL-4) | none ever | **No comm at all** | Apology + waitlist notice |
| `+27746255114` (WL-7) | none ever | **No comm at all (today)** | Send "we're checking for you" within their 24h window |
| 12 STK-* phones | none beyond bot interaction | No customer record exists | Best-effort nudge while session is recent; skip if cold (>48h) |

---

## 6. Draft follow-up message templates

Each draft is < 1024 characters (WhatsApp template body limit), simple SA-English, no "verified" / "trusted" claims.

### T1 — Request received, we are reviewing
> Hi {{name}}, this is Plug A Pro. We've received your request for {{service}} and we're checking which local provider can help. We'll come back to you shortly. Reply HELP if anything's wrong.

### T2 — Need more information
> Hi {{name}}, it's Plug A Pro again. To send your {{service}} request to a provider we need a bit more info: {{missing_field}}. Reply with that detail or tap below to continue. Thanks.

### T3 — Provider matching in progress (manual)
> Hi {{name}}, Plug A Pro here. We're looking for a suitable provider for your {{service}} job in {{suburb}}. This is being handled by our team — we'll come back within {{eta_hours}}h. Reply STOP if you no longer need help.

### T4 — Provider found / manual introduction (JR-B style — apology + intro)
> Hi {{name}}, this is Plug A Pro. Apologies for the delay — your {{service}} request has been accepted by {{provider_name}}. They can reach you on this number to plan the visit. Reply OK to confirm we can share your number with them.

### T5 — No provider available yet (JR-C / waitlist style)
> Hi {{name}}, this is Plug A Pro. We couldn't find an available provider for your {{service}} job in {{suburb}} this round. We've put you on our priority list and will message you as soon as someone is available. Sorry for the wait.

### T6 — Apology for delay (JR-A style)
> Hi {{name}}, Plug A Pro here. We owe you an apology — your {{service}} request from {{date}} took longer than it should have. We're back online with more providers now. Do you still need help? Reply YES and we'll set you up.

> All MARKETING/UTILITY templates must be registered in Meta Business Manager before use. Until that's done, follow-ups must be triggered manually inside an active 24h window OR via an already-approved template such as `slot_available`.

---

## 7. Product and UX fixes

Ordered by reach × ease, smallest first.

### P-1 (UX, ~1 day) — capture customer name reliably
Today JR-A and JR-B customers are saved as "WhatsApp Customer". The `collect_name` step in `field-service/lib/whatsapp-flows/job-request.ts` either skips or doesn't persist back to the `customers.name` column. Trace `createJobRequest()` and ensure `ctx.data.name` is written to both `customers.name` and the JR. Side-effect: existing rows need a one-off backfill (1 row each for JR-A, JR-B — trivial).

### P-2 (UX, ~half-day) — fix category case-normalisation
JR-A stored `category: "Appliances"`; provider supply uses `appliances`. Force `.toLowerCase()` at the customer-flow write site (job-request.ts on submit) AND at the dispatch read site (`filter.ts` / `candidate-pool.ts`). One-off backfill for JR-A (`update job_requests set category='appliances' where id='cmpwxgjwv0012jv04pjuuikdx'`).

### P-3 (UX, ~half-day) — `addr_confirm` recovery nudge
4 of 12 stuck conversations are mid-address. STK-4 (`+27788695657`) was one tap from submitting. Add a cron that, X minutes after `updatedAt` on a `flow=job_request` conversation that's not `complete`, sends a UTILITY-template nudge "tap to continue". Only inside the 24h window.

### P-4 (UX / product) — surface "browse first" / category availability in the WA flow before location
Today the user picks a category, gives an address, then learns we don't serve them. WL-2 (painting, Outside Gauteng) is the canonical wasted journey. Reverse the order: show pilot region first, then category. Already discussed in the `notify-me capture for unavailable categories` work (commit `d84c89ad`) — confirm it's live and effective.

### P-5 (product) — supply alarm dashboard
Auto-flag categories with `<3` approved providers in a region. Today: garden (1), plumbing (0). Block ad spend for those categories until supply exists.

---

## 8. Data and admin fixes

| Surface | Today | Proposed |
|---|---|---|
| `/admin/dispatch` filters | OPEN \| MATCHING only | Add `EXPIRED-no-followup`, `MATCHED-customer-not-notified`, `case-OPEN-no-owner` |
| Communication status column | Not on list view | Show: last template, status, age, # Re-engagement failures |
| Manual match action | `ForceAssignButton` per candidate (good) | Also add: "skip — send one-off offer to a custom-picked provider" |
| Manual customer follow-up | `sendAdminWhatsappAction` server action exists but no UI | Add a "Send template" form on `/admin/messages` flag-gated by `admin.messages.outbound` (already exists), with template chooser + dry-run preview |
| Waitlist visibility | None | New `/admin/waitlist` page listing `service_area_waitlist` rows + last comm + "send follow-up" action |
| Stuck-conversation visibility | None | New `/admin/conversations/stuck` view of recent (≤7d) non-complete `job_request` flows; ops can send a recovery nudge |
| Case-close hook | Manual | When `match.status` transitions to MATCHED, auto-close the dispatch case |
| Communication audit | `message_events` (good) | Surface per-customer comm timeline in customer detail page — already partly built (CustomerNotes) |
| Audit log for ops messages | `AdminAuditEvent` via crudAction (good) | Include `templateName` + `to` + `failureReason` in the metadata |
| 24h-window detection | None | Helper: before sending any non-template message to a customer, look up last inbound from that phone; if >24h, switch to MARKETING template |

---

## 9. Implementation plan

### Phase 1 — Immediate operational actions (today / tomorrow)
1. **Notify JR-B customer (`+27686819941`) about Vigilance Chauke match.** Manual WhatsApp (within or outside template window) + close case.
2. **Reach out to JR-C customer Andries (`+27680805333`).** Confirm if still needed; manually push Donald Bhunu again.
3. **Send waitlist apology / acknowledgement to WL-2, WL-4, WL-7** (`+27655405077`, `+27785982935`, `+27746255114`). At minimum a "we received you" reply.
4. **Run a one-off operator nudge to STK-4** (`+27788695657`, addr_confirm stuck today, was one tap away).
5. **Backfill `category=appliances`** on JR-A and re-evaluate whether to re-engage that customer.

### Phase 2 — Low-risk product fixes (this week)
1. **Customer name capture fix (P-1).**
2. **Category case-normalisation (P-2).**
3. **`addr_confirm` recovery nudge cron (P-3).**
4. **Surface `service_area_waitlist` in `/admin/waitlist`** — read-only first, with copy-to-clipboard for the phone number; no auto-send.
5. **Surface stuck conversations in `/admin/conversations/stuck`** — read-only.

### Phase 3 — Deeper engineering fixes (next sprint)
1. **`post_match_customer_provider_accepted` as approved MARKETING template** in Meta + reroute send through `sendTemplate`.
2. **Pre-send 24h-window helper** + automatic switch from interactive → approved template when outside the window.
3. **Auto-close `cases` on MATCH success** + auto-create a new follow-up case if `customerContactedAt` is null 30 min after MATCH.
4. **Admin "compose & send" UI** on `/admin/messages` that uses the existing `sendAdminWhatsappAction` server action (dry-run by default).
5. **Customer-recontact loop activation** (`promptCustomersForNewProviderAvailability`) — confirm cron schedule + scope to West Rand.

### Phase 4 — Reporting / dashboard improvements
1. **Daily ops report** (already partly exists per OpenBrain memory): include "matched-but-not-notified", "waitlist not yet contacted", "stuck flows ≤24h".
2. **Per-category supply alarm**: red flag categories with <3 approved providers.
3. **Per-suburb supply visualisation**: shows which pilot suburbs are under-supplied for which categories.

---

## 10. Acceptance criteria

This investigation is successful when:

- [x] Every client request is accounted for (22 enumerated: 3 JR + 7 WL + 12 stuck)
- [x] Every open request has a recommended next action (see §2 table)
- [x] Every request has a communication status (see §2 + §5)
- [x] Every matchable request has up to 3 provider recommendations (see §4)
- [x] Every request needing clarification has a draft client message (see §6)
- [x] Every request with no communication is flagged (4 phones in §5)
- [x] Manual match opportunities are clearly listed (JR-B, JR-C, JR-A re-engage, WL-7)
- [x] Systemic product issues are identified (8 items in §3, fixes in §7/§8)
- [ ] Safe fixes are implemented or clearly proposed — **PROPOSED, not implemented** (the user asked investigation-first)
- [x] No production messages are sent without explicit approval — none sent
- [ ] OpenBrain is updated with findings — pending (last task)

---

## Appendix A — Pilot provider pool snapshot (jhb_west, active)

Total active pilot providers: **55**. KYC distribution: 4 VERIFIED, 1 IN_PROGRESS, 50 NOT_STARTED (relying on grace flag).

Approved-category counts:

| Category | Approved in pilot |
|---|---|
| handyman | 18 |
| painting | 13 |
| cleaning | 10 |
| carpentry | 10 |
| appliances | 10 |
| diy | 9 |
| tiling | 7 |
| plastering | 6 |
| rhinoliting | 4 |
| **garden** | **1** ⚠ |
| **plumbing** | **0** 🔴 |

## Appendix B — Failed-message reason summary

| Customer | Template | Status | Failure | Count |
|---|---|---|---|---|
| `+27726588278` (JR-A) | `interactive:quick_match_progress_update` | FAILED | Re-engagement message | 141 |
| `+27686819941` (JR-B) | `interactive:quick_match_progress_update` | FAILED | Re-engagement message | 1 |
| `+27686819941` (JR-B) | `interactive:quick_match_rotation` | FAILED | Re-engagement message | 2 |
| `+27686819941` (JR-B) | **`post_match_customer_provider_accepted`** | FAILED | Re-engagement message | 1 |
| `+27680805333` (JR-C) | `interactive:quick_match_progress_update` | FAILED | Re-engagement message | 2 |

Root cause: interactive (non-template) message dispatched outside Meta's 24h customer-service window. Fix path: register the post-match notice as a MARKETING template + use `sendTemplate`.

---

**Status of this engagement:** Analysis only. No code changes, no production messages sent. The five "immediate operational actions" in §9 Phase 1 are recommended for the user / ops team to action manually today.
