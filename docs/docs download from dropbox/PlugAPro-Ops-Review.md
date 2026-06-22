# Plug A Pro Operations Dashboard Review

**Reviewer:** Product Operations / UX (acting)  
**Surface reviewed:** `https://admin.plugapro.co.za/` (Ops admin)  
**Date of walkthrough:** 19 April 2026  
**Coverage:** Operations dashboard, Validation, Dispatch, Field Exceptions, Quotes, Bookings (incl. one detail), Matches, Applications, Providers (incl. one profile), Customers (incl. one profile), Categories, Locations, Disputes, Payments, Reports, Messages, Settings, Journey Flows.  
**Scope note:** The brief talks about "subscribed users." Plug A Pro is a two-sided marketplace, not a subscription product, so I've read "subscribed users" as the closest analogues here: **customers** (people who request a service) and **providers** (people who fulfill it). I've reviewed both.

---

## A. Executive summary

Honest take first: this dashboard is genuinely well-conceived at the **dashboard layer** — it's organized as a "Control Tower" with seven proper operational queues (Validation, Dispatch, Field, Quotes, Finance, Trust, Supply), each with its own SLA target, ageing counter, "yours / unclaimed / overdue" split, and a one-click route into the queue. That's exactly the shape a real ops team needs and it's better than what most early-stage marketplaces ship. Credit where it's due.

Where it falls apart is the **moment you try to actually do the work**. Once you click into a case, the tools to *resolve* it largely aren't there. There's no notes field, no reason codes, no escalation, no manual override on the matching filter, no audit trail on records, no close-out modal, no "mark resolved" action, no SLA timer on the case itself, and the customer/provider profiles are too thin to investigate from. The dashboard tells you something is wrong — but the workflow to fix it ends a click later.

The single most damning bit of evidence is the live state right now: **3 service requests are sitting in Dispatch, all 6–7 days old against a 15-minute SLA** (≈ 600× over), and the system has retried auto-assignment dozens of times with NO_MATCH because every candidate provider fails on `OUTSIDE_SERVICE_AREA`. Yet:

- The top dashboard tile reads "Operational exceptions: 0" — so the cases are *invisible* on the headline number even though they're catastrophically late.
- There is no "force assign," "expand radius," "manually override filter," or "escalate to supply" button on the case.
- The Dispatch button "Auto-assign top candidate" will do nothing — there are 0 eligible candidates, but the button still appears live.
- There's no way for ops to record what they tried, why, or close the case out as "Cannot fulfil — coverage gap."

**What works**
- Queue-first dashboard model with SLA targets, age, ownership counts.
- Real evidence trail on Dispatch *attempts* (NO_MATCH log with reasons).
- Quote revision history on completed bookings is properly preserved.
- Journey Flows page is a nice piece of internal documentation that helps onboarding.
- Sensible information architecture across the sidebar.

**What's weak**
- The case-detail layer is a dead end — no notes, no reason codes, no close-out, no audit trail.
- Customer and provider profiles have almost none of the fields ops needs to investigate.
- The headline KPI ("Operational exceptions: 0") doesn't agree with the detail (3 overdue Dispatch).
- No filtering, no bulk action, no assignment, no SLA breach alerts surfaced to a human.
- No way to override the matching filter or relax eligibility from the case.

**Top 5 operational gaps**
1. **No close-out workflow.** There is no "Resolve / close" action with reason code, note, and operator stamp on any case, anywhere I looked.
2. **No case-level audit trail or notes.** You can't see who touched a record, when, or why — and you can't add a note. That breaks both investigation and accountability.
3. **No exception override on Dispatch.** When the matcher returns 0 eligible providers, ops has no lever to relax the filter, manually assign outside the rules, or escalate to a supply queue.
4. **Headline numbers don't reflect breaches.** "Operational exceptions: 0" while three cases are 600× past SLA is a dangerous lie of omission. Ageing must roll up to the top.
5. **Subscriber/profile views are empty shells.** The customer profile gives ops one action (marketing opt-in override) and shows "Booking history (1) — No bookings yet" in the same view. Investigation can't start here.

**Biggest single risk to daily operations**
Cases get stuck and nobody can tell. The combination of (a) a green-looking dashboard, (b) no SLA breach surfacing on the home view, (c) no notes/audit so the next ops user doesn't know what was tried, and (d) no close-out path, means real customer requests will rot for days exactly like the three already in the queue. In a marketplace, that's churn on both sides — customers go elsewhere, providers see no leads.

---

## B. What is relevant on the dashboard

| Dashboard element | Why it matters to Operations | Present / Missing / Partial | Comments |
|---|---|---|---|
| Total subscribed users | Headline of who you serve | **Missing** | No customer/provider count on the dashboard. Customers page shows "4 total" only when you navigate to it. |
| Users requiring action | Tells you where to start | **Partial** | Queue tiles do this for *requests* and *applications*, not for users. There's no "users with issues" view. |
| Exception queues | Core ops surface | **Present** | Seven proper queues: Validation, Dispatch, Field, Quotes, Finance, Trust, Supply. Architecturally strong. |
| Unresolved cases | Drives daily work | **Partial** | Visible per queue, not aggregated. No global "open cases by age" roll-up. |
| Ageing items | Catches rot | **Partial** | "Oldest" is shown per tile (e.g. Dispatch: oldest 7d). Not visualised as a histogram or surfaced as an alert. |
| Status breakdowns | Operational health at a glance | **Partial** | "Open / Matching / Unclaimed / overdue" appears on tiles. No status pie or trend by status. |
| Failed onboarding/verification | Funnel hygiene | **Partial** | Provider Applications page exists, but only Pending vs Approved. No "rejected / expired / abandoned" view. |
| Incomplete profiles | Quality risk | **Missing** | No "incomplete provider profile" or "missing certifications" report. |
| Payment/subscription anomalies | Revenue protection | **Partial** | Payments page has Pending / Failed / Paid filters. With 0 records I cannot judge depth. |
| Duplicate users | Data hygiene | **Missing** | No duplicate detection, no merge action. |
| Blocked / suspended users | Trust & safety | **Partial** | Provider profile has a "Deactivate" button (good). Customer profile has nothing equivalent. No "Suspended" filter on lists. |
| Pending close-out items | Ageing / WIP | **Missing** | No "ready to close" or "awaiting close-out" queue. |
| Escalation indicators | Catches breach | **Missing** | No escalation flag, no breach badge on cases, no "this is past SLA" callout next to the affected case. |
| Audit / activity visibility | Accountability | **Partial** | Dispatch has an attempt-by-attempt log of the matcher (good). Bookings show created date. **Customer / provider / quote / booking records have no field-level audit trail.** |
| Top-of-page KPI accuracy | Trust in dashboard | **Broken** | "Operational exceptions: 0" with 3 overdue Dispatch is contradictory. Definitions don't line up. |
| SLA target visibility per queue | Sets the bar | **Present** | "Triage inside 30 min", "Assign inside 15 min", etc. Genuinely useful. |
| Pipeline funnel | Volume sanity | **Present** | Today: Requests 2, Matches 0, Quotes 0, Bookings 0 — useful but read-only. |
| 7-day trend chart | Pattern detection | **Present** | Requests / Bookings / Completed line chart, with day-, week-, month-toggles. |

---

## C. User journey assessment

| Step | What the ops user is trying to do | What supports them today | What is missing | Severity |
|---|---|---|---|---|
| 1. Open dashboard | Get a 10-second read of what's on fire | Queue tiles with counts and SLAs render fast | Headline "Operational exceptions: 0" while Dispatch has 3 overdue. Ops will trust the wrong number. | **High** |
| 2. Understand current operational state | Know what's healthy vs degraded | Queue tiles colour/label "No open work" vs "X overdue" | No global "system status" line, no breach banner, no week-on-week deltas | **Medium** |
| 3. Find users with exceptions | Find the people behind the issues | None — exceptions are framed around *requests*, not users | No "users with open exceptions" view, no search-by-status on Customers / Providers | **High** |
| 4. Filter and prioritise exceptions | Sort by age, owner, severity | Bookings has status tabs only | No filter by SLA breach, owner, severity, channel, region. No bulk select. No saved views. | **High** |
| 5. Open a subscribed user profile | Pull up the file to investigate | Customers / Providers list links to per-user pages | List has no search, no filter, no segmentation. Profile loads but the page is bare. | **Medium** |
| 6. Inspect profile details and history | See identity, status, history, notes | Phone, email, channel, opt-ins, bookings table on customers; skills, areas, availability on providers | No notes, no internal flags, no exception history, no link to active cases, no audit log, no certifications/equipment on provider despite the matcher checking them | **Critical** |
| 7. Identify root cause of exception | Read the trail | Dispatch console shows "Considered 12, eligible 0" with reason codes per provider | Reasons are at provider level, not aggregated ("90% of misses are OUTSIDE_SERVICE_AREA"). Nothing on the case timeline beyond auto-assign attempts. | **High** |
| 8. Take corrective action | Fix the case | "Claim dispatch", "Auto-assign top candidate", "Refresh ranked shortlist" | No "manually assign / override filter", no "expand radius", no "escalate to supply", no "notify customer of delay", no "cancel with reason" | **Critical** |
| 9. Record notes / reason codes | Log what you did | None | No notes field anywhere on a case. No reason code library. | **Critical** |
| 10. Close out the case / mark resolved | End the case cleanly | None | No "Resolve" / "Close" button on any case I opened. Booking detail has an "Actions" header but it's empty. | **Critical** |
| 11. Verify case removed from active queue | Confirm it's done | Counts on tiles update, presumably | I couldn't verify because there is no close-out action to test. No "recently resolved" view to verify queue removal. | **Critical** |
| 12. Confirm action is auditable and reversible | Trust the system | Quote History on completed bookings is preserved (good) | No record-level audit trail elsewhere; no reopen flow; no operator name attached to anything I saw | **Critical** |

---

## D. Exception management gaps

| Gap | Impact | Recommended fix | Priority |
|---|---|---|---|
| No filters on queues (status, date, type, owner, ageing) | Can't triage at volume — works only when queues have <5 items | Add server-side filters: status, age band (0-1h / 1-24h / 24h+ / SLA breached), owner, region, category, severity. Save as views per user. | **P0** |
| No bulk actions | Can't release/claim/mass-assign multiple cases at once | Add multi-select with bulk claim, release, reassign, comment, close. | **P1** |
| No assignment / ownership at the case level | "0 yours" counter on tiles is meaningless without a way to assign | Add Owner field on each case, with claim/release/reassign actions and a "My queue" filter. | **P0** |
| No SLA timer on the case itself | Ops sees "overdue" only at the queue level. Can't see *which* case is closest to breach. | Show SLA badge on every row: green/amber/red against target with countdown. | **P0** |
| No notes / internal comments | Knowledge dies between shifts. Investigation can't be handed off. | Add a notes timeline on every case (free text + @mentions of teammates). | **P0** |
| No reason codes | No structured data for analysis ("why are we losing cases?") | Add a small reason-code taxonomy per queue (e.g., for Dispatch close-out: COVERAGE_GAP, CUSTOMER_CANCELLED, DUPLICATE, FRAUD, PROVIDER_NO_SHOW). | **P0** |
| No escalation path | Cases that can't be resolved at L1 have nowhere to go | Add "Escalate" action with target queue (e.g. Supply / Trust) and reason. | **P1** |
| No retry/resend/reopen | Some flows need re-trigger (e.g., resend WhatsApp message, reopen a closed case) | Add explicit retry actions where relevant; add Reopen on closed cases with note. | **P1** |
| No attachments / evidence on cases | Disputes and field exceptions need photos/receipts attached at case level | Allow file/photo attachments on case timeline. | **P2** |
| No full activity timeline on a case | Ops has to mentally piece together what happened | Single chronological feed per case: status changes, messages, notes, ops actions, system events (matcher attempts, webhook results). | **P0** |
| No override on matching filter | Real cases stuck because "no eligible provider" — and ops has no lever | Add "Override and assign" with mandatory reason: pick any provider, force-assign, log why. | **P0** |
| No breach alert into a human | Cron exists for "Queue breach detection / Ops WhatsApp alert" per Journey Flows page, but I see no alert UI on the dashboard | Surface a top-of-screen banner ("3 cases past SLA — open Dispatch") and add a true Operational Exceptions queue that aggregates breaches across all queues. | **P0** |
| Definitional inconsistency on top KPI | "Operational exceptions: 0" while Dispatch shows 3 overdue | Either define "Operational exceptions" to include SLA breaches across queues, or rename to be precise. The number must match the queue counts. | **P0** |
| No duplicate detection | Marketplaces accumulate dupes — same phone, two profiles | Add duplicate flagging on customer/provider creation and a "review duplicates" queue with a merge action. | **P2** |

---

## E. Subscriber profile assessment

I opened two profiles to test: customer **Lerato Molefe** (cust0000000000000002 — has an open Dispatch case) and provider **Kagiso Sithole** (prov000000000000002 — Electrical, who *should* be the provider for Lerato's case but is filtered out for being outside her service area).

### Customer profile — data available
Phone, email, channel ("WhatsApp only"), customer-since date, marketing/service opt-in state, header showing "Booking history (1)".

### Customer profile — data missing
- Identity verification state / KYC
- Subscription state (the platform doesn't have one — fine — but if the brief wants this, it's worth saying clearly)
- Address(es)
- Active / open requests (Lerato has one open Dispatch case — it is not linked from her profile)
- Exception history / case history
- Notes / internal flags (e.g. "VIP", "complaint history", "do not contact after 18:00")
- Audit trail (who changed what, when)
- WhatsApp conversation log
- Linked provider history (who has she worked with)
- Ratings she has given

### Customer profile — actions available
One: "Opt in (admin override)" for marketing.

### Customer profile — actions missing
Block / suspend, reset session, resend last WhatsApp, merge duplicate, add note, escalate to trust team, link to active case, close-out, contact customer.

### Provider profile — data available
Name, phone, status (Active / available), experience ("—" empty), approval flag, skills list, service areas, weekly availability, totals (jobs, completion rate).

### Provider profile — data missing
- **Certifications and equipment** — the matcher filters on these (`MISSING_REQUIRED_CERTIFICATION`, `MISSING_REQUIRED_EQUIPMENT`) but the profile doesn't show them. So ops cannot tell *what* is missing or fix it from here.
- ID / KYC verification state
- Background-check status
- Onboarding completion %
- Bank / payout details state ("verified / unverified")
- Active / open leads
- Notes / strikes / complaint history
- Audit trail
- Last seen on WhatsApp / last lead responded to
- Coverage map (visual)

### Provider profile — actions available
"Deactivate." That's it.

### Provider profile — actions missing
Edit service areas, edit/add certifications, edit/add equipment, change skills, force-suspend with reason, reactivate, send re-onboarding link, write to provider, attach a strike, view leads sent.

### Can the ops team close out from the profile view?
**No.** Neither profile has a close-out concept. The profile is a viewer, not a workspace.

---

## F. Close-out capability

**Can the operations team close out a user exception end-to-end?**  
No. Not in any meaningful sense.

**Where does the journey break?**

1. **Discovery** — fine. The Dispatch tile correctly shows 3 cases.
2. **Triage** — partially fine. You can see age and "unclaimed."
3. **Investigation** — breaks. The case detail (the Dispatch console with the request open via `?request=…`) shows the matcher's reasons but no customer history, no notes, no prior actions.
4. **Action** — breaks. The only actions on a Dispatch case are Claim, Auto-assign top candidate (will fail when 0 eligible — no warning), and Refresh shortlist. Nothing to manually override the filter, escalate, or cancel.
5. **Recording** — breaks. No notes field, no reason code, no audit trail.
6. **Close-out** — breaks. There is no "Close case" / "Resolve" button anywhere I clicked.
7. **Verification** — breaks. With no close-out action, I couldn't verify queue removal. The "Booking detail" page does have an "Actions" *heading* but it renders no buttons even on a Completed booking, which suggests this is a known gap rather than an oversight.
8. **Auditability** — partial. Dispatch retains a NO_MATCH log; Quote History is preserved on bookings; everywhere else, no operator name, no timestamp on changes, no field-level history.

**What's needed to make close-out real**

- A "Resolve / close" action on every case (Dispatch, Field, Quotes, Finance, Trust, Validation) with mandatory: outcome status, reason code (from a per-queue list), free-text note, optional attachments.
- An operator-name + timestamp stamp on every state change.
- A "Reopen" action with reason that returns the case to its queue.
- A "Recently closed (last 7 days)" view per queue so ops can verify and audit.
- A locked, append-only activity timeline on every case.
- Removal from the active queue happens automatically once the case is in a closed status.

---

## G. Recommended improvements (top 10, in priority order)

1. **Add a real "Resolve / Close case" action with reason code + note + operator stamp**, on every queue and every case-detail view. Without this, the platform is observation-only.  
   *Journey step affected:* 9, 10, 11, 12. *Expected benefit:* Cases can actually be ended; backlog finally moves; auditable record of what ops did and why.

2. **Surface SLA breaches on the home dashboard.** Either redefine "Operational exceptions" as "any case past SLA across all queues," or add a new global "Breached SLA" tile and a top-of-page banner. The number must match what the queues show.  
   *Step:* 1, 2. *Benefit:* Ops trusts the dashboard. No more silent ageing.

3. **Per-case notes timeline + activity log.** Append-only feed: status changes, ops actions, system events, free-text notes, @mentions.  
   *Step:* 6, 7, 9, 12. *Benefit:* Knowledge survives shift handovers; reduces "what's been tried?" rework; gives audit defensibility.

4. **Owner / claim / release on every case + "My queue" filter.** Currently "0 yours" is shown but I saw no claim button on the case (only on Dispatch as "Claim dispatch"). Make this universal.  
   *Step:* 4. *Benefit:* Real workload distribution and accountability.

5. **Filters and bulk actions on every queue:** age band, status, owner, region, category, channel, severity. Bulk claim/release/close.  
   *Step:* 4. *Benefit:* Triage time scales sub-linearly with volume.

6. **Manual override on Dispatch.** "Force assign" (pick any provider, with reason); "Expand radius this once"; "Escalate to Supply" with target.  
   *Step:* 8. *Benefit:* Stops the current 3 cases from rotting forever; rescues real revenue.

7. **Make subscriber profiles a real workspace.** On the customer profile: list of active requests, exception history, notes, internal flags, "block/suspend," "send WhatsApp," "merge duplicate," "view conversation." On the provider profile: certifications, equipment, ID/KYC state, payout state, leads sent, last-seen, edit service areas.  
   *Step:* 6. *Benefit:* Investigations finish on the profile instead of bouncing between five tabs.

8. **Reason-code library per queue, plus close-out outcomes.** Small, controlled list (e.g. Dispatch close-outs: COVERAGE_GAP / DUPLICATE / CUSTOMER_CANCELLED / FRAUD / PROVIDER_UNRESPONSIVE / OTHER+freetext).  
   *Step:* 9, plus reporting. *Benefit:* Real analytics on *why* cases close — drives roadmap on supply, trust, product.

9. **Recently-resolved + reopen.** "Closed in last 7 days" view per queue; Reopen action with mandatory note; close-out is reversible.  
   *Step:* 11, 12. *Benefit:* Confidence to close. Operators stop hoarding open cases out of fear.

10. **Dashboard reconciliation with Journey Flows.** The Flows page already documents an "Ops alerts cron / queue breach detection / Ops WhatsApp alert." Wire that signal into the dashboard UI as a banner and into a real "Breached" queue. The plumbing exists — the surface doesn't.  
    *Step:* 1, 2. *Benefit:* You stop relying on a WhatsApp ping to a single human and put the breach in front of every ops user who logs in.

---

## H. Final verdict

**Is this dashboard operationally ready for exception management and user close-out?**  
No. Not yet.

It's halfway there — and to be fair, the half it has done is the harder half conceptually (queue model, SLAs, ageing, the right seven categories, a real matcher with explainable reasons). That foundation is good. What's missing is the boring-but-essential **case lifecycle layer**: claim → investigate → act → record → close → audit → reopen. Without that layer, ops can monitor but not operate. They can see the fire but not put it out.

**What must be fixed before rollout or scale-up:**

1. Add a true close-out action (with reason code + note + operator + timestamp) to every queue.
2. Add a notes/activity timeline to every case.
3. Reconcile dashboard KPIs with queue reality — "Operational exceptions" must include SLA breaches; surface a breach banner.
4. Add manual override on Dispatch (force-assign / expand radius / escalate) so the current 3 stuck cases — and the next batch — don't sit forever.
5. Build out the customer and provider profiles into real investigation surfaces, especially exposing the certifications and equipment that the matcher already filters on.
6. Add filters, bulk actions, and ownership on every queue.

The most concrete proof point that this isn't ready right now: **as I write this, three real customer requests in Cape Town, Durban, and Pretoria have been waiting 6–7 days against a 15-minute SLA, and the dashboard's headline number says zero exceptions.** Fix that one inconsistency first — it earns the right to ship the rest.

---

## Evidence captured during the walkthrough

- **Dashboard top tiles:** Validation 0, Dispatch 3, Field 0, Operational exceptions 0; today funnel: Requests 2 → Matches 0 → Quotes 0 → Bookings 0 → Completed 0 → Paid 0 → Revenue R 0.
- **Dispatch queue:** 3 open requests — "No power to lounge plug points" (Lerato Molefe, Claremont, Cape Town, age 7d, Open, Unclaimed, 0 leads sent); "Overgrown back garden — full clearance" (Siphamandla Dube, Morningside, Durban, 6d, Matching, 0 leads sent); "Roof leaking after recent storms" (Boitumelo Sithole, Arcadia, Pretoria, 6d, Open, 0 leads sent). All against a 15-min SLA.
- **Dispatch matcher log:** Every recorded attempt for these requests is `AUTO_ASSIGN — NO_MATCH — Considered 12–14, eligible 0`, with every candidate provider tagged `OUTSIDE_SERVICE_AREA / MISSING_REQUIRED_SKILL / MISSING_REQUIRED_CERTIFICATION / MISSING_REQUIRED_EQUIPMENT`. Dozens of identical attempts logged.
- **Dispatch actions present:** Claim dispatch, Auto-assign top candidate, Refresh ranked shortlist. *No* override/escalate/cancel/notify-customer.
- **Customers list:** 4 customers, columns: Name / Phone / Channel / Bookings / Last booking. No filter, no search, no status, no risk flags.
- **Customer profile (Lerato Molefe):** Contact, channel, customer-since, WhatsApp opt-in flags, "Booking history (1)" header but body says "No bookings yet." Single action: "Opt in (admin override)." No link to her open Dispatch case.
- **Providers list:** 12 providers, all "available," all "0 active jobs." Skill column visible; no service-area, certification, or equipment column.
- **Provider profile (Kagiso Sithole):** Skills (Electrical), Service Areas (Midrand/Centurion/Halfway House/Waterfall/Noordwyk — Gauteng only). The Cape Town request can never match him. Single action: "Deactivate." No certifications or equipment shown despite the matcher filtering on them.
- **Applications:** 0 pending, 2 reviewed (one with reviewed-date "—", one with 2026/04/16) — minor audit consistency issue.
- **Bookings:** 1 booking (Sandton plumbing job, completed). Booking detail shows quote history (good — full revision trail) and an empty "Actions" header.
- **Disputes / Payments / Field Exceptions / Quotes / Validation / Messages:** all empty (0 records).
- **Reports:** April month-to-date — 1 booking, R 0 revenue, 1 job completed, 100% conversion, 12 active providers, top categories Electrical/Garden/Roofing/Plumbing.
- **Settings:** Read-only platform metadata. Integrations are env-var managed; no UI for SLA config, no roles/permissions UI, no audit-log viewer.
- **Locations:** 225 nodes (3 provinces, 6 cities, 15 regions, 201 suburbs, 4 addresses) with Activate/Deactivate/Delete per node. Western Cape is present at province level — so the missing match for the Claremont case is provider service-area data, not a missing location node.
- **Journey Flows:** 8 architecture diagrams documenting current routes, including "Automations and Signals" which references "Ops alerts cron, Queue breach detection, Ops WhatsApp alert" — the alert plumbing exists but I saw no breach banner / alert surface in the dashboard UI.

**Sources**
- [Operations Dashboard](https://admin.plugapro.co.za/admin)
- [Dispatch console](https://admin.plugapro.co.za/admin/dispatch)
- [Customers list](https://admin.plugapro.co.za/admin/customers)
- [Customer: Lerato Molefe](https://admin.plugapro.co.za/admin/customers/cust0000000000000002)
- [Providers list](https://admin.plugapro.co.za/admin/providers)
- [Provider: Kagiso Sithole](https://admin.plugapro.co.za/admin/providers/prov000000000000002)
- [Bookings list](https://admin.plugapro.co.za/admin/bookings)
- [Booking 00000001 detail](https://admin.plugapro.co.za/admin/bookings/book000000000000001)
- [Matches](https://admin.plugapro.co.za/admin/matches)
- [Applications](https://admin.plugapro.co.za/admin/applications)
- [Validation Queue](https://admin.plugapro.co.za/admin/validation)
- [Field Exceptions](https://admin.plugapro.co.za/admin/field-exceptions)
- [Quote Approvals](https://admin.plugapro.co.za/admin/quotes)
- [Disputes](https://admin.plugapro.co.za/admin/disputes)
- [Payments](https://admin.plugapro.co.za/admin/payments)
- [Reports](https://admin.plugapro.co.za/admin/reports)
- [Messages](https://admin.plugapro.co.za/admin/messages)
- [Locations](https://admin.plugapro.co.za/admin/locations)
- [Settings](https://admin.plugapro.co.za/admin/settings)
- [Journey Flows](https://admin.plugapro.co.za/admin/flows)
