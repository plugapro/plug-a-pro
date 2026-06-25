# Plug A Pro Admin — CRUD & Administration Capability Audit

**Scope:** Can an Ops user / admin / platform owner actually **administer** the platform from `admin.plugapro.co.za`? i.e. Create, Read, Update, Delete records; drill down between entities; manage taxonomy; manage their own admin users.  
**Date of rescan:** 19 April 2026.  
**Method:** Logged in as the ops account, opened every module, inventoried every action (buttons, inputs, selects, links) on both list and detail views where available. Used the live DOM so client-hydrated controls are counted.

---

## TL;DR — the blunt verdict

No. As a platform owner or admin, **you cannot fully administer Plug A Pro from this admin surface**. Right now it behaves like a **read-mostly control tower** with one genuinely full-CRUD module (Locations), two modules with workflow actions (Dispatch, Applications), and a long list of "viewer-only" modules for the rest. The core entities on a marketplace — customers, providers, service requests, quotes, bookings, payments, disputes, categories, admin users — are **all effectively read-only from the UI.** To change most data you'd be going straight to the database.

There's also a new reliability concern that didn't show up in the first review: on this rescan, the **Provider detail page and the Booking detail page both crashed** with "An unexpected error occurred on this page. Error ID: 3811911274." Those are core views. If they're crashing for the Ops user today, the "Administration" story is worse than capability gaps — some of the capabilities that *do* exist are currently broken.

Two corrections I owe from my first review:

1. I missed two dispatch actions on my first pass. Dispatch actually exposes **5** buttons: Claim dispatch, Auto-assign top candidate, Refresh ranked shortlist, **Re-dispatch (retry leads)**, and **Escalate to Supply**. Re-dispatch and Escalate are meaningful — they mean supply escalation IS possible, contrary to what I wrote earlier. My earlier "no escalation path" statement was wrong. Everything else about Dispatch (no force-assign, no override the filter, no edit the request, no cancel with reason, no audit trail on the case) still stands.
2. The first review treated Dispatch's 3 open cases as "test data posing as real." The second conversation confirmed they're just seed/test records. Doesn't change the capability findings — it just means the operational-urgency framing doesn't apply.

---

## Full module-by-module CRUD matrix

Legend: **C** = create a new record, **R** = read/list, **U** = update an existing record, **D** = delete / deactivate, **S** = search on the list, **F** = filter on the list, **B** = bulk select/act, **X** = export.

| Module | Route | C | R | U | D | S | F | B | X | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Operations dashboard | `/admin` | — | ✓ | — | — | — | — | — | — | Read-only. No administration actions on any tile. |
| Validation queue | `/admin/validation` | — | ✓ | — | — | — | — | — | — | Empty today. No "Create request" affordance. |
| Dispatch console | `/admin/dispatch` | — | ✓ | ◐ | — | — | — | — | — | 5 case-level actions: Claim, Auto-assign top candidate, Refresh ranked shortlist, Re-dispatch (retry leads), Escalate to Supply. **Cannot** edit the request itself, cannot force-assign outside the filter, cannot cancel with reason. |
| Field Exceptions | `/admin/field-exceptions` | — | ✓ | — | — | — | — | — | — | Empty today. No action scaffolding visible on the empty state. |
| Quote Approvals | `/admin/quotes` | — | ✓ | — | — | — | — | — | — | Empty today. No action scaffolding visible. |
| Bookings (list) | `/admin/bookings` | — | ✓ | — | — | — | ◐ | — | — | Only filter is status tabs (All / Scheduled / Rescheduled / Completed / Cancelled). No search, no date range. |
| Booking (detail) | `/admin/bookings/[id]` | — | ✓ | — | — | — | — | — | — | Renders Quote History and completion note, nothing interactive. **Detail view crashed on rescan** (Error ID 3811911274). Has an "Actions" heading but no buttons even when it does render. |
| Matches moderation | `/admin/matches` | — | ✓ | — | — | — | ◐ | — | — | Status tabs only. No edit or override. |
| Applications | `/admin/applications` | — | ✓ | ◐ | — | — | — | — | — | Approve/Reject is implied by the "APPROVED" status on reviewed rows but no Pending records exist today to expose the action surface. Reviewed rows have no edit. |
| Providers (list) | `/admin/providers` | — | ✓ | — | — | — | — | — | — | 12 providers. No "Add provider", no search, no filter. |
| Provider (detail) | `/admin/providers/[id]` | — | ✓ | — | ◐ | — | — | — | — | Only action is Deactivate. **Detail view crashed on rescan** across at least `prov000000000000001` and `prov000000000000002` (same Error ID 3811911274). Earlier today it rendered Deactivate and a read-only profile. |
| Customers (list) | `/admin/customers` | — | ✓ | — | — | — | — | — | — | 4 customers. No "Add customer", no search, no filter. |
| Customer (detail) | `/admin/customers/[id]` | — | ✓ | ◐ | — | — | — | — | — | Only action is "Opt in (admin override)" for marketing messages. No contact edit, no block, no delete, no merge. |
| Categories | `/admin/categories` | — | ✓ | — | — | — | — | — | — | 8 hardcoded job categories. **No UI to add, edit, remove, or reorder.** Read-only descriptive list. |
| Locations | `/admin/locations` | ✓ | ✓ | ✓ | ✓ | — | ◐ | — | — | **The gold-standard module.** Add node (type, label, slug, parent, lat/lng), inline edit of label, Deactivate, Delete. 225 nodes rendered in a taxonomy tree. Still no search or bulk actions. |
| Disputes | `/admin/disputes` | — | ✓ | — | — | — | — | — | — | Empty today. No action scaffolding. |
| Payments | `/admin/payments` | — | ✓ | — | — | — | ◐ | — | — | Status tabs (All/Paid/Pending/Failed). Empty today. No retry/refund/write-off actions visible even in tab structure. |
| Reports | `/admin/reports` | — | ✓ | — | — | — | ◐ | — | — | Month-to-date plus category and provider performance. No CSV export. |
| Messages | `/admin/messages` | — | ✓ | — | — | — | — | — | — | "Last 100 outbound events." Read-only log. No resend, no retry, no search. |
| Settings | `/admin/settings` | — | ✓ | — | — | — | — | — | — | Read-only configuration (mode, timezone, currency, app URL, category list, integrations note). **Integrations configured via env vars only.** No admin user UI, no role UI, no SLA config UI. |
| Journey Flows | `/admin/flows` | — | ✓ | — | — | — | — | — | — | Documentation (Mermaid diagrams). Read-only. |

**Tally:**
- Fully CRUD-capable modules: **1 of 20** (Locations).
- Workflow-capable but not record-editable: **2** (Dispatch, Applications).
- Single-action partial: **2** (Providers profile → Deactivate; Customers profile → marketing opt-in).
- **Read-only: 15**.

---

## What an Ops / admin / owner **cannot** currently do from the UI

Framing it from the persona's point of view — the way you'd think if you sat down to run the platform.

**Customers**
- Can't add a customer manually. If someone phones in, there's no concierge path.
- Can't edit a customer's name, phone, email, or address.
- Can't block or suspend a customer.
- Can't delete a customer or deactivate an account.
- Can't merge duplicates (there's no duplicate queue).
- Can't impersonate or view-as (legit support action).
- Can't view a customer's WhatsApp conversation history.
- Can't attach internal notes or flags (VIP, risk, "do not SMS after 18:00").
- Can't see the customer's open cases from their profile.
- Can't see a customer's booking history correctly — the header says "(1)" and the body says "No bookings yet." (Data display bug, not capability.)

**Providers**
- Can't add a provider directly. Providers only exist through the WhatsApp application → approval flow.
- Can't edit skills, service areas, certifications, equipment, availability, or contact details.
- Can't temporarily suspend (only Deactivate, which is binary).
- Can't re-activate from the UI.
- Can't record strikes / trust events on a provider.
- Can't see or change the provider's payout / bank state.
- Can't see the leads that were sent to a provider.
- Can't invite or onboard a provider off-platform (everything routes through WhatsApp).
- Provider detail page is currently crashing with a 500-type error.

**Service requests (JobRequests)**
- Can't create a request on behalf of a customer.
- Can't edit a request (address, category, description, photos) after it's in the system.
- Can't cancel a request with a reason code.
- Can't force-assign a request to a specific provider.
- Can't override the matcher's eligibility filter (OUTSIDE_SERVICE_AREA etc).
- Can't add internal notes to a request or its case.

**Quotes**
- Can't create a quote manually.
- Can't edit a quote post-submission.
- Can't cancel or void a quote with a reason.
- Can't extend a quote's expiry.

**Bookings**
- Can't reschedule a booking from the admin.
- Can't cancel a booking (with or without reason).
- Can't issue a refund from the admin.
- Can't change the assigned provider.
- Can't mark a booking as disputed or add a trust flag.
- Booking detail's "Actions" heading renders no buttons. Detail page crashed on rescan.

**Payments**
- Can't manually record a payment (e.g. cash received off-platform).
- Can't retry a failed payment.
- Can't initiate a refund.
- Can't write off a payment with a reason.
- Can't reconcile a PSP webhook manually.

**Disputes**
- Can't open a dispute on behalf of a customer or provider.
- Can't resolve with an outcome, reason code, operator stamp.
- Can't attach evidence.
- Can't escalate beyond the queue.

**Categories**
- Can't add a category (e.g. "Pool maintenance", "Solar install").
- Can't edit category name or description.
- Can't remove or deactivate a category.
- Can't reorder or introduce subcategories.
- **This is locked data.** For a marketplace whose whole supply-demand matching is keyed on category, that's a notable platform-owner gap.

**Admin & staff users**
- **No admin user management anywhere in the UI.** There's no "Admin users" page, no "Roles" page, no "Invite teammate" button. Admins are presumably provisioned via env vars or direct DB access per the Settings page note.
- Cannot see who has admin access.
- Cannot revoke access without a dev.
- Cannot scope admin roles (Ops vs Finance vs Owner).

**Platform configuration**
- Cannot change timezone, currency, mode, or app URL from the UI (read-only).
- Cannot change SLA targets per queue (though they're displayed on tiles).
- Cannot toggle features or set operational policy.

**Observability for an owner**
- Cannot export any data (no CSV, no JSON download).
- Cannot search across any list.
- Cannot run ad-hoc reports or slice data by date range beyond the single 7/14/30-day toggle on the dashboard chart.
- Cannot view an audit log of who did what.

---

## What *does* work properly

Credit where it's due — some parts of this interface are carrying the whole admin.

- **Locations** is the only module that behaves like real admin software. Add / edit / deactivate / delete, hierarchical tree, geocoding, parent linking. If every other module looked like Locations, most of this report would not exist.
- **Dispatch** has real workflow controls: Claim, Auto-assign, Refresh, **Re-dispatch (retry leads)**, **Escalate to Supply**. The escalation path exists — I incorrectly said otherwise last time. What Dispatch *still* lacks is the ability to edit or override the request, manually force-assign outside the filter, and leave an audit trail.
- **Reports** renders sensible month-to-date metrics, top categories, and provider performance without issue.
- **Journey Flows** is a genuinely well-documented internal reference. It's the kind of thing most products never build.
- **Navigation** is consistent. The sidebar is the same everywhere and every module is one click away.
- **Applications** approvals appear to work end-to-end (records show APPROVED status) — I just couldn't test the Approve/Reject button interaction because no pending items exist today.

---

## Drill-down capability (can I navigate between related entities?)

Mixed. Some links exist but the full graph isn't traversable.

| From → To | Present? | Notes |
|---|---|---|
| Customer list → Customer profile | ✓ | Clicking a row works. |
| Customer profile → their open service requests | ✗ | Missing — no link from Lerato's profile to her open Dispatch case. |
| Customer profile → their booking history | ◐ | Section exists but renders inconsistently (header count vs empty body). |
| Provider list → Provider profile | ✓ | Works (when the page isn't erroring). |
| Provider profile → leads sent / active cases | ✗ | No cross-reference. |
| Booking → Customer | ✓ | Text link. |
| Booking → Provider | ✓ | Text link. |
| Booking → Quote history | ✓ | Rendered inline on booking detail (when it renders). |
| Match → Booking | ✓ | Text link. |
| Dispatch case → Customer | ✓ | Text reference visible. |
| Dispatch case → Provider candidate → Provider profile | ◐ | Candidate names shown; depending on rendering, clicking through leads to the provider profile (which may currently crash). |
| Any entity → its audit/history | ✗ | No entity has a visible change history. |

---

## New reliability finding (not in the first review)

Two detail routes are currently returning a server error: `/admin/providers/[id]` and `/admin/bookings/[id]`. Both render:

> PAGE ERROR  
> Something went wrong  
> An unexpected error occurred on this page.  
> Error ID: 3811911274

At the time of the first walkthrough these same URLs rendered fine. The error id is identical across both routes and across different record IDs, which suggests a shared code path broke between the two scans — possibly a recent deploy, a Prisma model change, or a dependent service (Supabase, Blob) becoming unavailable. Either way, **a core "read-a-single-record" function is currently broken in two modules, which means the admin can't even inspect individual providers or bookings right now**, let alone modify them.

Worth having your dev inspect the Error ID in Sentry/logs and confirm whether it's data-dependent (the specific seed rows) or shape-dependent (a migration removed a field the detail page still reads).

---

## Direct answers to your three questions

**"Does it allow me to do CRUD, meaning fully modify the data?"**  
No. Only Locations supports full CRUD. Every other module is either read-only or has a single narrow action. For customers, providers, requests, quotes, bookings, payments, disputes, categories, admin users — you cannot meaningfully modify data from the UI today.

**"Drill into the data?"**  
Partially. List → record → some related entities works (Customer list → Customer profile; Booking → Customer/Provider). But critical traversals are missing: Customer profile → their active cases, Provider profile → leads sent, any record → its audit history. The graph isn't complete.

**"Can you as ops/admin/platform owner fully administer the platform?"**  
No. To be precise:
- As **Ops** — you can monitor; you can do a handful of dispatch actions; you can't resolve cases with notes/reason codes; you can't edit customer or provider records. You are effectively running a dashboard, not a control panel.
- As **Admin** — you cannot invite or manage other admin users from the UI. You cannot change platform config. You cannot add job categories.
- As **Platform owner** — you cannot change the shape of the platform (categories, SLAs, integrations, roles). You cannot export data for board packs. There is no owner-level surface at all — the admin.plugapro.co.za app is ops-flavoured, not owner-flavoured.

---

## Implementation-plan impact

The existing implementation plan (`PlugAPro-Ops-Implementation-Plan.md`) covers **case workflow** — close-out, notes, audit trail, filters, overrides. That's still right. But this CRUD audit exposes a **second, parallel workstream the plan doesn't yet include**: general record-level CRUD for the primary entities, plus admin user management and category management.

To keep it tidy, I'd add three new workstreams to the existing plan:

- **WS11 — Entity editing (C/R/U/D) across Customers, Providers, Requests, Quotes, Bookings, Payments, Disputes.** Pattern already exists (Locations). Replicate the add/edit/delete/deactivate pattern for each entity's list and detail page, each behind a feature flag.
- **WS12 — Admin user & role management.** Admin users page, invite flow, role assignment (Ops / Finance / Trust / Owner), revoke access, audit on admin actions.
- **WS13 — Category management & platform config.** Bring categories into the Locations-style admin experience (add, edit, deactivate, reorder, subcategory support). Expose SLA targets as editable config.

And one production-readiness fix that doesn't belong in the plan but must happen before any of this:

- **Stabilise detail pages.** Provider detail and Booking detail both crash today. Root-cause the Error ID 3811911274, fix the regression, add route-level error boundaries that degrade gracefully (show partial data instead of a full error page), and add a smoke test that visits one record of each type after every deploy.

---

## One-paragraph summary for leadership

The Plug A Pro admin dashboard is useful as a monitoring surface but cannot currently be used to administer the platform. Of twenty admin modules, only one (Locations) supports full create/read/update/delete; the rest are read-only or have one narrow action. Customers, providers, service requests, quotes, bookings, payments, disputes, categories, and admin users all effectively require database access to change. There is no admin user management, no role management, no audit trail, no search, no export, and no bulk operations anywhere in the UI. Separately, two core detail pages (provider and booking) are currently returning server errors and cannot be opened at all. Before this platform can be run by a non-engineering ops team, the list of missing administration capabilities in this document must be built. Good news: the Locations module is the proof-of-concept — the team already knows how to build the pattern; they just need to apply it to every entity.

---

## Sources

- [Operations Dashboard](https://admin.plugapro.co.za/admin)
- [Validation](https://admin.plugapro.co.za/admin/validation)
- [Dispatch](https://admin.plugapro.co.za/admin/dispatch) — 5 action buttons confirmed on live DOM (Claim dispatch, Auto-assign top candidate, Refresh ranked shortlist, Re-dispatch (retry leads), Escalate to Supply).
- [Field Exceptions](https://admin.plugapro.co.za/admin/field-exceptions)
- [Quote Approvals](https://admin.plugapro.co.za/admin/quotes)
- [Bookings](https://admin.plugapro.co.za/admin/bookings) / [Booking 00000001](https://admin.plugapro.co.za/admin/bookings/book000000000000001) (detail page currently crashes with Error ID 3811911274).
- [Matches](https://admin.plugapro.co.za/admin/matches)
- [Applications](https://admin.plugapro.co.za/admin/applications)
- [Providers](https://admin.plugapro.co.za/admin/providers) / [Provider prov000000000000002](https://admin.plugapro.co.za/admin/providers/prov000000000000002) (detail page currently crashes with Error ID 3811911274).
- [Customers](https://admin.plugapro.co.za/admin/customers) / [Customer cust0000000000000002](https://admin.plugapro.co.za/admin/customers/cust0000000000000002)
- [Categories](https://admin.plugapro.co.za/admin/categories) — 8 hardcoded, no UI actions.
- [Locations](https://admin.plugapro.co.za/admin/locations) — full CRUD, 225 nodes.
- [Disputes](https://admin.plugapro.co.za/admin/disputes)
- [Payments](https://admin.plugapro.co.za/admin/payments)
- [Reports](https://admin.plugapro.co.za/admin/reports)
- [Messages](https://admin.plugapro.co.za/admin/messages)
- [Settings](https://admin.plugapro.co.za/admin/settings) — configuration is read-only; integrations are env-var managed; no admin user UI.
