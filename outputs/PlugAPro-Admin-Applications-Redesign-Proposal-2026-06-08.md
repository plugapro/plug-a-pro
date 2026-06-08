# Admin → Applications screen — Redesign proposal & implementation notes

**Date:** 2026-06-08
**Scope:** `field-service/app/(admin)/admin/applications/page.tsx` and supporting modules
**Target users:** Ops, Admin, Owner roles
**Status:** Approved → implemented behind feature flag `admin.applications.redesign_v2`
**Production safety:** No DDL or DML. No destructive migrations. All mutations continue to flow through the existing `crudAction()` audit pipeline.

---

## 1. What the legacy page does well (preserved)

- Every mutation goes through `crudAction()` → `AuditLog` + `AdminAuditEvent`.
- Server actions enforce role (`OPS | ADMIN | OWNER`), flag (`admin.crud.applications`), and pre-state checks.
- Approval is gated by `evaluateProviderProfileCompleteness()` and the duplicate-phone check.
- Ops queue claim/release (`OPS_QUEUE_TYPES.PROVIDER_ONBOARDING`) is wired in.
- WhatsApp onboarding recovery is integrated (`provider-onboarding-recovery.ts`).
- Approved providers expose category-level approval.
- Banner system via `getApplicationsAdminMessage()`.

The redesign preserves all of this. Only presentation and information density change.

---

## 2. Current operational problems

| # | Problem | Evidence |
|---|---------|----------|
| P1 | No queue summary at top — admin cannot see counts per queue at a glance | Section headers `Pending ({pending.length})` only after scrolling past the recovery table |
| P2 | Pending cards are huge — every record fully expanded | ~150px per card with skills/area/experience/availability + evidence + 4 forms |
| P3 | Three different status systems visible at once without a unifying model | `ApplicationStatus`, `KycStatus`, ops-queue claim state, completeness, recovery stage |
| P4 | No filter or search | None |
| P5 | Approved section between Pending and Reviewed inflates the page | Section ordering in `page.tsx` |
| P6 | Reviewed table mixes actionable (`MORE_INFO_REQUIRED`) with terminal (`REJECTED`, `CANCELLED`) | `reviewed.filter((a) => !['PENDING','APPROVED'].includes(a.status))` |
| P7 | No mobile layout | `grid-cols-2` and 4-button row breaks below `md` |
| P8 | Reject input + Reject button could fire empty-reason rejects | `RejectApplicationSchema.reason` was `optional()` |
| P9 | No priority on pending applications | Recovery rows had `recoveryPriorityForStage`, pending had no equivalent |
| P10 | Evidence panel verbose; raw URL strings; no thumbnails | Lines 1032–1058 of legacy `page.tsx` |
| P11 | Every action is rendered inline → 20 pending cards = 20×4 forms in DOM | Pending cards render all forms inline |
| P12 | No completeness scoring per row | Result of completeness check used only for `canApprove` |

---

## 3. Information architecture (v2)

```
 ┌────────────────────────────────────────────────────────────────────────────┐
 │  Provider Applications                                  Send all due nudges │
 │  Unified worklist across WhatsApp recovery + applications                  │
 ├────────────────────────────────────────────────────────────────────────────┤
 │  All · 87   Ready · 7   Stuck · 12   More info · 3                         │
 │  Conflict · 1   Idle · 5   Approved · 134   Rejected / Cancelled · 21      │
 ├────────────────────────────────────────────────────────────────────────────┤
 │  [search q] [Source: WA|PWA|Admin] [ID] [Photo] [Claim]                     │
 ├──────────────────────────────────┬─────────────────────────────────────────┤
 │  P1 Ready to review (7)          │  Selected row drawer                    │
 │  ─ row · row · row               │   Header (name, masked phone, copy)     │
 │                                  │   Status block                          │
 │  P2 Stuck mid-flow (12)          │   Completeness (bar + missing list)     │
 │  ─ row · row …                   │   Application details + evidence        │
 │                                  │   Recovery panel (if any)               │
 │  P3 More info / Conflict (4)     │   Category approval (APPROVED only)     │
 │  P4 Idle (5, collapsed)          │   Sticky action footer                  │
 │  P5 Approved (134, collapsed)    │                                         │
 │  P6 Terminal (21, collapsed)     │                                         │
 └──────────────────────────────────┴─────────────────────────────────────────┘
```

### 3.1 Queue strip (top, click-to-filter)

| Queue | Rule |
|-------|------|
| Ready to review (P1) | `status = PENDING` AND `canApprove` AND no conflict |
| Stuck mid-flow (P2) | Recovery row with mid-funnel stage OR PENDING + missing required + recovery present |
| More info (P3) | `status = MORE_INFO_REQUIRED` |
| Conflict (P3) | In `conflictingApplicationIds` OR recovery `flow_conflict` |
| Idle (P4) | PENDING + missing required + no recovery, OR recovery in early stages |
| Approved (P5) | `status = APPROVED` |
| Rejected / Cancelled (P6) | `status ∈ {REJECTED, CANCELLED}` |

All counts derive from the same `applications` + `recoveryRows` arrays already loaded — no new queries.

### 3.2 Unified row model

Implemented in `field-service/lib/applications-queue.ts`:

- `UnifiedApplicationRow` merges an `ApplicationInput` with the corresponding `ProviderOnboardingRecoveryRow` by phone-tail join.
- Recovery-only rows (no matching application) render alongside application rows in the same priority order.
- `phoneKey` is normalised E.164 (via existing `normalizePhone`); `phoneMasked` is `+27 ••• ••• 1234`.
- `bucket` and `priority` are computed pure-function from inputs.
- `flags` exposes derived booleans: `hasIdNumber`, `hasProfilePhoto`, `attachmentCount`, `kycStatus`, `outsideSessionWindow`, `claimedByCurrentUser`.

### 3.3 Compact row

One scannable line. Source icon, name, masked phone, application-id tail, primary skill, primary area, last activity, signal chips (`ID ✓` / `Photo` / `n docs` / `KYC <status>` / recovery stage / conflict / claim), `n/8` completeness pill, and a one-line recommended action.

Clicking a row sets `?selected=<rowId>`. The drawer renders server-side from the same data — no client state required.

### 3.4 Side drawer (sticky on desktop)

Sections:

1. Header — name, masked phone, **Copy WhatsApp link** client island, status + priority chips, application id tail.
2. Status block — application, provider, KYC, recovery stage, last activity, claim owner.
3. Completeness — progress bar `n/8`, blocking-approval list, expandable recommended list.
4. Application details — skills, areas (chip lists), experience, availability, call-out fee, submission date, ID supplied flag, admin notes.
5. Evidence — attachment list with safe-preview gate; non-safe items get an `unsafe` chip.
6. Recovery — stage, last seen, follow-up due, last outcome, 23h-window warning, message preview.
7. Category approval (APPROVED only) — uses existing per-category Approve/Reject/Hold forms.
8. Sticky action footer — Approve, Request more info (textarea), Reject (textarea), Claim/Release, link to full provider profile, Send recovery nudge/template.

Every form uses the existing `<SubmitButton>` which is `useFormStatus`-aware (loading state) and respects `disabled`.

### 3.5 Filters + search

All URL-encoded so deep-linking and refresh work:

- `?queue=` bucket
- `?q=` text (matches name, primary skill, primary area, application id tail; matches phone when ≥3 digits)
- `?src=` source (whatsapp / pwa / admin / unknown)
- `?id=` 1 / 0 — ID provided or missing
- `?photo=` 1 / 0 — photo provided or missing
- `?claimed=1` / `?unclaimed=1`
- `?selected=<rowId>` for the drawer

Filters apply client-side over the already-loaded 100 rows. No new queries; no schema change.

### 3.6 Actions and feedback

| Action | Disabled when | Success banner | Failure banner |
|---|---|---|---|
| Approve | `!crudEnabled`, conflict, incomplete | `application_approved` | `application_approval_failed` / `incomplete_application_for_approval` / `duplicate_active_application` |
| Reject | `!crudEnabled`, reason < 5 (client + schema + server guard) | `application_rejected` | `application_reject_reason_required` / `application_rejection_failed` |
| Request more info | `!crudEnabled`, reason < 5 | `application_more_info_sent` | `application_more_info_failed` |
| Claim / Release | `!crudEnabled` | (no banner, row updates) | (no banner) |
| Update category approval | `!crudEnabled` | (no banner, row updates) | (no banner) |
| Send recovery nudge | `!crudEnabled`, `submitted_no_recovery` stage | existing `recovery_sent` / `recovery_sent_template` | existing `recovery_*` codes |
| Send all due | `!crudEnabled` | existing `recovery_batch_dispatched` | existing |

No silent submissions. Every form has explicit pending labels via `SubmitButton`.

---

## 4. Backend / schema changes

Only **two** code changes outside the new files:

1. **`RejectApplicationSchema.reason`**: tightened to `z.string().min(5)`. UI also requires it. Server action redirects to `application_reject_reason_required` if a reason under 5 chars arrives via direct POST.
2. **`getApplicationsAdminMessage`**: added 8 new banner codes for the success/failure paths above. Wired into the approve/reject/more-info server actions.

**No DDL. No DML. No schema migration. No data backfill.** All other behaviour is unchanged.

---

## 5. Files changed / added

| File | Type | Lines | Purpose |
|---|---|---|---|
| `field-service/lib/feature-flags-registry.ts` | edit | +5 | Register `admin.applications.redesign_v2` (default off) |
| `field-service/scripts/feature-flag-groups.ts` | edit | +1 | Add flag to `OPS_CRUD_FEATURE_FLAGS` |
| `field-service/lib/admin-action-messages.ts` | edit | +29 | 8 new banner codes |
| `field-service/app/(admin)/admin/applications/page.tsx` | edit | +63 / -3 | Schema `min(5)`, success redirects, try/catch around reject + more-info, v2 flag branch, action prop-bag |
| `field-service/lib/applications-queue.ts` | new | 586 | Pure data model, builder, bucket classifier, filter helpers |
| `field-service/__tests__/lib/applications-queue.test.ts` | new | 392 | 32 unit tests — phone helpers, bucket classification, recovery merge, ordering, flags, counts, filters, URL round-trip |
| `field-service/components/admin/applications/CopyWaLink.tsx` | new | 42 | Client island — clipboard copy for `wa.me/<phone>` |
| `field-service/app/(admin)/admin/applications/applications-v2-view.tsx` | new | ~840 | The v2 server view: queue strip, filters, worklist, drawer |
| `outputs/PlugAPro-Admin-Applications-Redesign-Proposal-2026-06-08.md` | new | this file | Design proposal + implementation notes |

---

## 6. State coverage

| State | Behaviour |
|---|---|
| Zero applications, zero recovery rows | Empty state — illustration, copy, no resetable filters |
| Zero pending, many approved | Queue strip still shows counts; approved bucket renders |
| Slow API | Existing `loading.tsx` skeleton still applies |
| Partial data (missing name/phone/area/category) | Row shows "Unknown name" italic; primary skill / area fall back to "No category" / "No area" |
| Failed image attachment | Falls back to file-type icon |
| Unknown journey origin | Source icon labelled "Unknown source" |
| Unknown ApplicationStatus | TS prevents it; bucket chip would default to outline |
| Large volume | Server caps at `take: 100`. Footer notice "Showing the latest 100 records. Refine filters to surface older items." |
| Repeated refresh | Existing `revalidatePath` invalidates. URL state preserves filters + selection |
| Admin action failure | Try/catch + redirect to banner. No silent failures |

---

## 7. Responsive behaviour

| Breakpoint | Layout |
|---|---|
| `<640px` | Queue strip wraps; filters wrap; worklist single column; drawer becomes a vertically-stacked card (still navigable via `?selected=`) |
| `640–1024px` | Queue strip wraps; worklist single column; drawer stacks below |
| `≥1024px` | 2-col grid: worklist + sticky drawer (`top-4 max-h-[calc(100vh-2rem)]` with `overflow-y-auto`) |

No new dependencies. All Tailwind + shadcn primitives already present in the repo.

---

## 8. Security & audit

- Phone is masked by default (`+27 ••• ••• 1234`). Reveal is deferred to v2.
- `idNumber` is **never rendered** — only "ID supplied: Yes/No" in the drawer; "ID" / "ID missing" chip on rows. Aligns with the existing POPIA §26 TODO at `schema.prisma:365`.
- Attachment URLs open in a new tab; unsafe-preview attachments get an `unsafe` chip.
- All mutations stay inside `crudAction()` with role + flag gates + audit writes.
- Page-level `requireAdmin()` and `proxy.ts` route protection unchanged.

---

## 9. Out of scope for v1 (follow-ups)

These are deliberately deferred — they would require schema, new queries, or substantial query churn:

1. Persisted `journey_origin` column (today inferred best-effort from attachments).
2. Voucher / credit row indicator.
3. Persisted audit-trail tab in the drawer.
4. Server-side pagination beyond 100 rows.
5. Bulk actions (multi-select approve / nudge).
6. CSV export of the current queue view.
7. Phone reveal with `AdminAuditEvent` write.
8. Application-level `crudAction()` for category approval banner consistency.

---

## 10. Rollout

Behind feature flag `admin.applications.redesign_v2` (default **off**, owner: `ops`, registered in `lib/feature-flags-registry.ts`).

To enable per-admin:

```bash
cd field-service && npx tsx scripts/seed-flags.ts --flag=admin.applications.redesign_v2 --enable
# or via DB:  setFlag('admin.applications.redesign_v2', { enabled: true, enabledForUsers: ['<adminId>'] })
```

While the flag is off, `/admin/applications` renders the existing v1 view byte-for-byte unchanged (other than the small `RejectApplicationSchema.reason = min(5)` hardening, which applies to v1 too).

Suggested rollout:
1. Enable for one admin (owner). Verify worklist, filters, drawer, action paths.
2. Enable for the rest of ops once confident.
3. Decommission v1 in a follow-up PR once stable for ≥1 week.

---

## 11. Risks & follow-ups

| Risk | Mitigation |
|---|---|
| Filter complexity creeps server-side | v1 is client-side over the 100 loaded rows; v2 should add cursor pagination |
| `MORE_INFO_REQUIRED` queue surfaces stalled threads | v2 should add an "awaiting > 7d" sub-chip |
| Schema tightening (`reason.min(5)`) could break legacy callers | Grep confirms no non-page callers; schema is local to `page.tsx` |
| Performance with many attachments | Drawer-only attachment grid; worklist row shows count chip only |
| Dropbox sync collision history | All work re-applied after pausing Dropbox sync (see incident note in OpenBrain log) |

---

## 12. Acceptance criteria mapping

| Criterion | Where addressed |
|---|---|
| See how many applications in each queue | §3.1 queue strip |
| Filter by queue with one click | §3.5 URL state |
| Scan without opening every record | §3.3 compact rows |
| Identify stuck / incomplete / ready / approved | §3.1 buckets |
| Row-level missing-info indicator | §3.3 signal chips + completeness pill |
| Open detail without losing place | §3.4 drawer via `?selected=` |
| Visible feedback on actions | §3.6 success + failure banners |
| Loading / empty / error states | §6 state coverage |
| No destructive prod data actions | §4 — only zod `min(5)` and new banners |
| OpenBrain log | Written at session end |
