# Plug A Pro — Ops Agent Workflow Team

**Engineering specification & actionable task list**
Owner: Ops Platform · Pilot: Johannesburg West Rand · Status: design → build
Audience: Claude Code / Codex (directly actionable) and ops/product reviewers

---

## 0. Grounding — what already exists (do not rebuild)

This feature slots into existing infrastructure. Every task below **extends** these rails; it does not invent parallel ones.

| Capability | Where it lives | How the Ops Agents use it |
|---|---|---|
| Scheduled jobs | 17 Vercel cron endpoints under `field-service/app/api/cron/*` + `app/api/internal/cron/*`, auth'd by `CRON_SECRET` bearer, configured in `field-service/vercel.json` | Agent runners are new cron endpoints in the same pattern |
| In-app OpenBrain write | `field-service/lib/ai-loop/openbrain-writer.ts` → `writeOperationalEvent()`, `safeCapture()`; taxonomy in `lib/ai-loop/events.ts`; NDJSON file sink in `lib/ai-loop/sink.ts` | Every agent observation/decision/recommendation is emitted through this writer (already redacts PII, never throws) |
| WhatsApp send + policy | `lib/whatsapp.ts` (`sendTemplate`, `sendText`), `lib/whatsapp-policy.ts` (`canSend(phone, template)`), `lib/messaging-templates.ts` (`TEMPLATES` registry), `MessageEvent` model | Draft → approve → `sendTemplate/sendText`. `canSend()` is the gate before any draft is even surfaced as "sendable" |
| Audited admin mutations | `crudAction()` (writes `AuditLog` + `AdminAuditEvent` in one tx); admin pages are Server Components calling Prisma directly | All approve/reject/send actions on recommendations and drafts go through `crudAction()` |
| Operator worklists | `lib/ops-queue.ts` (`OpsQueueType`), `lib/applications-queue.ts`, `lib/nudges/queue.ts`; `Case`/`CaseEvent` framework | Agent recommendations surface as a new worklist that links into the existing case framework |
| Feature flags | `lib/flags.ts` (`isEnabled`), `FeatureFlag` table, `scripts/seed-flags.ts` | Every agent and every auto-send path ships behind its own flag |
| Lifecycle state | Rich enums/timestamps on `JobRequest`, `Match`, `MatchAttempt`, `AssignmentHold`, `DispatchDecision`, `Booking`, `Job`, `Quote`, `Payment`, `Dispute`, `ProviderApplication`, `Provider` | Agents read these; they do not duplicate status |

**Consequence:** The new surface area is small and well-bounded:
1. Three new Prisma models (`OpsAgentRun`, `OpsRecommendation`, `OpsDraftMessage`) + one snapshot table (`ProviderProfileScore`) + one friction table (`RequestFrictionSignal`) + one briefing table (`OpsDailyBriefing`).
2. A `lib/ops-agents/` module — one pure "evaluator" per agent (deterministic scoring/classification, no side effects) plus one "runner" that persists results.
3. Cron + admin-trigger entry points reusing the existing cron pattern.
4. An admin review console under `/admin/ops-agents` with approve/edit/send/dismiss.

---

## 1. Proposed architecture

### 1.1 Layered design

```
┌──────────────────────────────────────────────────────────────────────┐
│  TRIGGERS                                                              │
│  • Vercel cron  (app/api/cron/ops-agents/<agent>/route.ts)            │
│  • Event hook   (after application submit, request submit, status txn) │
│  • Admin button ("Run review now" on /admin/ops-agents)               │
└───────────────┬──────────────────────────────────────────────────────┘
                │ calls
┌───────────────▼──────────────────────────────────────────────────────┐
│  RUNNER LAYER  lib/ops-agents/runner.ts                               │
│  • opens an OpsAgentRun row (status=RUNNING)                          │
│  • loads candidate set (e.g. applications submitted since lastRunAt)  │
│  • calls the pure evaluator per candidate                            │
│  • persists OpsRecommendation + OpsDraftMessage (status=PENDING)      │
│  • emits OpenBrain events via safeCapture()                          │
│  • closes the run (status=SUCCESS|PARTIAL|FAILED, counts, error)     │
└───────────────┬──────────────────────────────────────────────────────┘
                │ uses
┌───────────────▼──────────────────────────────────────────────────────┐
│  EVALUATOR LAYER  lib/ops-agents/<agent>/evaluate.ts   (PURE)         │
│  • input: plain data object (no Prisma client, no I/O)               │
│  • output: { classification, score, signals[], recommendation,       │
│              draftMessage? }                                          │
│  • deterministic, unit-testable, no network/db/clock side effects    │
└───────────────┬──────────────────────────────────────────────────────┘
                │ surfaced in
┌───────────────▼──────────────────────────────────────────────────────┐
│  REVIEW LAYER  /admin/ops-agents/*                                    │
│  • list of PENDING recommendations grouped by agent + severity        │
│  • approve / edit-draft / send / dismiss  (all via crudAction)        │
│  • Phase 3: auto-send when agent's auto-send flag + per-template      │
│    allowlist are both enabled                                        │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.2 Hard rules (enforced in code, not convention)

1. **Evaluators are pure.** No Prisma, no `fetch`, no `Date.now()` inside `evaluate.ts`. The runner injects `now` and pre-loaded data. This is what makes them unit-testable and replayable.
2. **No agent sends WhatsApp directly.** Agents only produce `OpsDraftMessage` rows in `PENDING_APPROVAL`. The *only* code path that calls `sendTemplate`/`sendText` for agent output is the approval action (Phase 1–2) or the auto-send worker behind a flag (Phase 3).
3. **`canSend()` is evaluated at draft time and re-checked at send time.** A draft for an opted-out recipient is created as `BLOCKED_POLICY`, never `PENDING_APPROVAL`, so ops never sees a sendable draft they legally cannot send.
4. **Every run and every recommendation is logged to OpenBrain** through `safeCapture()`. If the sink fails, the DB write still succeeds (writer never throws) — DB is source of truth, OpenBrain is the durable cross-session log.
5. **Idempotency by `(agentKey, entityType, entityId, dedupeWindow)`.** A second run inside the window updates the existing recommendation rather than spawning duplicates.

### 1.3 Why this shape (vs. "autonomous agents")

- Deterministic evaluators → reviewable, testable, explainable. No hidden model calls in the hot path. (An LLM may *draft message copy* in Phase 3, but classification/scoring stays rule-based and auditable.)
- Reuses cron + OpenBrain + WhatsApp policy that are already battle-tested in this repo.
- Admin-in-the-loop by construction; auto-send is an opt-in escalation, not the default.

---

## 2. Agent workflow breakdown

Common contract for all six agents:

```ts
// lib/ops-agents/types.ts
type AgentKey =
  | 'provider_application_review'
  | 'provider_profile_coach'
  | 'service_request_friction'
  | 'matching_journey_monitor'
  | 'post_match_follow_up'
  | 'ops_daily_briefing'

interface AgentEvaluation {
  agentKey: AgentKey
  entityType: 'PROVIDER_APPLICATION' | 'PROVIDER' | 'JOB_REQUEST' | 'MATCH' | 'BOOKING' | 'OPS_BRIEFING'
  entityId: string
  classification: string          // agent-specific enum value
  score?: number                  // 0–100 where the agent scores
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  signals: Signal[]               // structured, machine-readable reasons
  opsRecommendation: string       // human-readable internal recommendation
  recommendedActions: RecommendedAction[]   // typed action chips for ops
  draft?: DraftMessageSpec        // optional WhatsApp draft (template + params)
  dedupeKey: string               // stable per entity+intent
}
interface Signal { code: string; label: string; weight: number; detail?: string }
interface RecommendedAction { code: string; label: string; href?: string }
interface DraftMessageSpec {
  channel: 'WHATSAPP'
  recipientRole: 'PROVIDER' | 'CUSTOMER'
  recipientPhone: string
  template: keyof typeof TEMPLATES | 'FREEFORM'
  templateParams?: Record<string, string>
  freeformBody?: string           // only valid inside an open 24h session
  rationale: string               // why this message, shown to ops
}
```

### A. Provider Application Review Agent — `provider_application_review`

- **Trigger:** event hook after `ProviderApplication` submit/update **and** cron sweep every 25 min during pilot hours (mirror `provider-auto-approve` cadence).
- **Reads:** `ProviderApplication` (+ existing `Provider` by phone for duplicate detection), `lib/applications-queue.ts` bucket.
- **Completeness scoring (0–100, weighted):** name+contact (10), ≥1 skill mapped to a pilot category (15), ≥1 service area inside pilot polygon (15), experience text (8), availability + emergency/weekend flags (8), pricing approach — `callOutFee`/`hourlyRate`/`quoteAfterInspection` present (10), proof of work `evidenceFileUrls`/`evidenceNote` (12), profile photo readiness (8), references (6), KYC/identity readiness `idNumber` present + future banking (8).
- **Classification enum:** `ready_for_ops_review | needs_more_information | high_potential_but_incomplete | duplicate_or_suspicious | unsuitable_for_current_pilot_area`.
  - `duplicate_or_suspicious`: phone/idNumber/name collision with existing `Provider`/`ProviderApplication`, or evidence URL reuse.
  - `unsuitable_for_current_pilot_area`: no service area resolves to a West Rand `LocationNode`.
  - `high_potential_but_incomplete`: score 55–74 **and** has proof-of-work or strong references.
- **Output:** internal recommendation + draft WhatsApp to provider explaining the 2–3 highest-weight missing items, framed as "stronger profiles get more leads."
- **Does NOT** auto-approve (that remains the existing `provider-auto-approve` job) and does not auto-send.

### B. Provider Profile Coach Agent — `provider_profile_coach`

- **Trigger:** cron weekly (Mon 06:00 SAST) over `Provider` where `status IN (ACTIVE, UNDER_REVIEW)`; also event hook on profile update to re-score.
- **Attractiveness score (0–100):** `avatarUrl` (15), `portfolioUrls` count ≥3 (20), `bio` length/quality (15), declared response-time expectation (10), clear service-area labels (10), emergency availability flag (8), experience/qualifications (12), pricing guidance present (10).
- **Tracks improvement:** stores a `ProviderProfileScore` snapshot each run; the coach compares the latest two snapshots to detect whether a prior nudge produced a lift (`improvedSinceLastNudgeAt`). Feeds Phase-3 feedback loop.
- **Output:** ranked improvement list + draft nudge (template `provider_profile_coach` — to be registered, see §6).
- **Suppression:** do not nudge a provider more than once per 14 days; skip if the last nudge has not yet been responded to and is <7 days old.

### C. Service Request Friction Agent — `service_request_friction`

- **Trigger:** event hook on every `JobRequest` status transition + abandonment timer; nightly cron rollup.
- **Reads:** `JobRequest` (+ `MatchAttempt`, `DispatchDecision.noMatchReason/failureClass/primaryReason`, `Quote.status`, `Payment.status`) and `RequestFrictionSignal` rows (new — see §4).
- **Drop-off stage detection** maps `JobRequestStatus` + missing fields + last meaningful timestamp to a stage: `category | address | description | photo | urgency | slot | quote_payment | whatsapp_handoff`.
- **Friction reason classification:** `unclear_category | missing_address | no_available_slot | no_matching_provider | quote_too_expensive | payment_not_completed | next_step_unclear | provider_declined | ops_declined | duplicate_request | outside_pilot_area`. Derive `no_matching_provider`/`provider_declined` from `DispatchDecision.failureClass` + `MatchAttempt.responseOutcome`.
- **Output:** per-request ops follow-up recommendation **and** aggregated product-improvement findings (top friction stages this period). The product findings are the most valuable artifact — they feed the Daily Briefing and OpenBrain `improvement` domain.
- **No customer message by default** (privacy + low-trust during friction); ops can opt to draft a recovery message that reuses `customer_abandoned_recovery`.

### D. Matching Journey Monitor Agent — `matching_journey_monitor`

- **Trigger:** cron every 10 min during pilot hours (aligns with `match-leads` window).
- **Per active `JobRequest`/`Match` computes:** matched? time-to-first-match, provider response time (`AssignmentHold.offeredAt→respondedAt`), customer accept/reject, downstream `Booking`/`Job` state.
- **Stuck-request detection (SLA breaches):** `OPEN`/`MATCHING` > N min with no offer; offered hold expiring with no other candidates; `PROVIDER_CONFIRMATION_PENDING` past `matchFoundWhatsappSentAt` + N h; `QUOTED` with no decision past `validUntil − buffer`.
- **Escalation severity** scales with customer wait and request value. Emits to the ops worklist + (Phase 2) ops alert.
- **Recommended actions (typed chips, link into existing tooling):** `manual_assign` (→ `/admin/dispatch`), `request_more_details`, `prompt_provider`, `expand_service_area`, `mark_no_provider_available`, `flag_category_supply_gap`.

### E. Post-Match Follow-Up Agent — `post_match_follow_up`

- **Trigger:** cron daily 09:00 + event hook on `Job`/`Booking`/`Payment`/`Dispute` transitions.
- **Closure checks:** provider contacted customer (`Match.customerContactedAt`), job status progressed, job notes/photos captured, extra-work approvals resolved (`Job.AWAITING_APPROVAL`), invoice/payment status (`Payment.status`), customer review captured.
- **Detects incomplete closeout:** `COMPLETED` job with no payment record or no review; `PENDING_COMPLETION_CONFIRMATION` stale; provider non-responsive post-match.
- **Output:** follow-up drafts (customer review request via `customer_review_request`; provider invoice/closeout nudge) **and** escalations for disputes / payment failures / non-responsive providers → ops worklist with `CRITICAL` severity when money or a dispute is involved.

### F. Ops Daily Briefing Agent — `ops_daily_briefing`

- **Trigger:** cron daily 16:00 UTC (18:00 SAST), after the per-entity agents have run.
- **Aggregates** the day's `OpsAgentRun` + `OpsRecommendation` + `RequestFrictionSignal` + lifecycle counts into one `OpsDailyBriefing` row: new/incomplete applications, providers needing coaching, new/abandoned/declined requests, unmatched requests, slow provider responses, completed jobs, payment issues, top friction points, recommended product improvements, recommended provider-acquisition priorities (which categories/areas are supply-starved).
- **Output:** stored briefing (Markdown + structured JSON) visible at `/admin/ops-agents/briefings`, and one consolidated OpenBrain `knowledge` entry in the `monitoring` domain.

---

## 3. Database schema recommendations

All additive (House rule #2). New models in `field-service/prisma/schema.prisma`, additive migration only.

```prisma
enum OpsAgentKey {
  PROVIDER_APPLICATION_REVIEW
  PROVIDER_PROFILE_COACH
  SERVICE_REQUEST_FRICTION
  MATCHING_JOURNEY_MONITOR
  POST_MATCH_FOLLOW_UP
  OPS_DAILY_BRIEFING
}

enum OpsAgentRunStatus { RUNNING SUCCESS PARTIAL FAILED }

enum OpsRecommendationStatus {
  PENDING            // awaiting ops review
  ACKNOWLEDGED       // ops saw it, no message needed
  ACTIONED           // ops took a non-message action
  DISMISSED          // not relevant
  SUPERSEDED         // replaced by a newer run (dedupe)
}

enum OpsRecommendationSeverity { INFO LOW MEDIUM HIGH CRITICAL }

enum OpsDraftStatus {
  PENDING_APPROVAL
  BLOCKED_POLICY     // canSend() = false (opt-out / no session)
  APPROVED           // approved, not yet sent
  SENT
  REJECTED
  EXPIRED            // session/template window passed before approval
  FAILED             // send attempted, Meta returned error
}

model OpsAgentRun {
  id            String            @id @default(cuid())
  agentKey      OpsAgentKey
  trigger       String            // "cron" | "event" | "manual"
  status        OpsAgentRunStatus @default(RUNNING)
  startedAt     DateTime          @default(now())
  finishedAt    DateTime?
  windowFrom    DateTime?         // candidate selection lower bound
  windowTo      DateTime?
  candidates    Int               @default(0)
  recommended   Int               @default(0)
  draftsCreated Int               @default(0)
  error         String?
  metadata      Json              @default("{}")
  recommendations OpsRecommendation[]
  @@index([agentKey, startedAt])
}

model OpsRecommendation {
  id              String                    @id @default(cuid())
  runId           String
  run             OpsAgentRun               @relation(fields: [runId], references: [id])
  agentKey        OpsAgentKey
  entityType      String                    // PROVIDER_APPLICATION | PROVIDER | JOB_REQUEST | MATCH | BOOKING | OPS_BRIEFING
  entityId        String
  classification  String
  score           Int?                      // 0–100 where applicable
  severity        OpsRecommendationSeverity @default(MEDIUM)
  signals         Json                      @default("[]")   // Signal[]
  summary         String                                     // internal ops recommendation
  recommendedActions Json                   @default("[]")   // RecommendedAction[]
  status          OpsRecommendationStatus   @default(PENDING)
  dedupeKey       String                                     // (agentKey:entityId:intent)
  caseId          String?                                    // optional link to Case
  reviewedById    String?
  reviewedAt      DateTime?
  reviewNote      String?
  createdAt       DateTime                  @default(now())
  updatedAt       DateTime                  @updatedAt
  drafts          OpsDraftMessage[]
  @@unique([dedupeKey])
  @@index([agentKey, status, severity])
  @@index([entityType, entityId])
}

model OpsDraftMessage {
  id               String         @id @default(cuid())
  recommendationId String
  recommendation   OpsRecommendation @relation(fields: [recommendationId], references: [id])
  recipientRole    String         // PROVIDER | CUSTOMER
  recipientPhone   String
  channel          String         @default("WHATSAPP")
  templateName     String?        // null => freeform (session only)
  templateParams   Json           @default("{}")
  freeformBody     String?
  renderedPreview  String         // exactly what ops sees / what will send
  rationale        String
  status           OpsDraftStatus @default(PENDING_APPROVAL)
  policyReason     String?        // populated when BLOCKED_POLICY
  approvedById     String?
  approvedAt       DateTime?
  sentAt           DateTime?
  messageEventId   String?        // FK-ish link to MessageEvent.id after send
  failureReason    String?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  @@index([status, recipientRole])
}

model ProviderProfileScore {
  id               String   @id @default(cuid())
  providerId       String
  provider         Provider @relation(fields: [providerId], references: [id])
  attractiveness   Int      // 0–100
  signals          Json     @default("[]")
  missingItems     Json     @default("[]")
  nudgedAt         DateTime?
  improvedSinceNudge Boolean @default(false)
  createdAt        DateTime @default(now())
  @@index([providerId, createdAt])
}

model RequestFrictionSignal {
  id            String   @id @default(cuid())
  jobRequestId  String
  jobRequest    JobRequest @relation(fields: [jobRequestId], references: [id])
  dropoffStage  String     // category|address|description|photo|urgency|slot|quote_payment|whatsapp_handoff
  reasonCode    String     // see §2.C classification
  detail        String?
  resolved      Boolean  @default(false)
  createdAt     DateTime @default(now())
  @@index([dropoffStage, reasonCode, createdAt])
  @@index([jobRequestId])
}

model OpsDailyBriefing {
  id          String   @id @default(cuid())
  forDate     DateTime @db.Date
  markdown    String                       // rendered briefing
  metrics     Json     @default("{}")       // structured counts
  topFriction Json     @default("[]")
  acquisitionPriorities Json @default("[]")
  openbrainRef String?                      // observationId from safeCapture
  createdAt   DateTime @default(now())
  @@unique([forDate])
}
```

Add back-relations: `Provider.profileScores ProviderProfileScore[]`, `JobRequest.frictionSignals RequestFrictionSignal[]`.

---

## 4. Event tracking requirements

Instrument **at the source** (in the existing flows), not by polling, where the event is cheap to emit. Reuse `safeCapture()` taxonomy; add new event codes in `lib/ai-loop/events.ts`.

| Event point | Where to instrument | Emit |
|---|---|---|
| Application submitted/updated | `ProviderApplication` create/update path (provider signup actions) | `ops.application.observed` + enqueue review |
| Request stage advanced/abandoned | `BookingFlow.tsx` server actions + `JobRequest` status transitions | `RequestFrictionSignal` row on regression/abandon; `ops.request.stage` event |
| Match offered / responded | `lib/matching/*` (`AssignmentHold` offer/respond) | `ops.match.offer`, `ops.match.response` with latency |
| No-match decided | `DispatchDecision` NO_MATCH path | `ops.match.no_match` with `failureClass`,`primaryReason` |
| Job/payment/dispute transition | `JobStatusEvent`/`BookingStatusEvent`/`Payment`/`Dispute` writers | `ops.closeout.signal` |
| Agent run lifecycle | `lib/ops-agents/runner.ts` | `ops.agent.run.start|finish` |
| Recommendation created | runner | `ops.recommendation.created` |
| Draft approved/sent/blocked | approval action / auto-send worker | `ops.draft.approved|sent|blocked` |

Friction signals are **persisted** (queryable for trends) *and* emitted to OpenBrain. Latency/SLA metrics are computed in the Matching Monitor from existing timestamps — no new event needed for those.

---

## 5. Admin UI requirements

New route group under the existing admin shell: `field-service/app/(admin)/admin/ops-agents/`. Follow the established Server-Component + `crudAction` pattern; gate with `isEnabled('admin.ops_agents', ...)`.

- `/admin/ops-agents` — **Review inbox.** Recommendations grouped by agent, sorted by severity then age. Each card: entity link, classification badge, score, top 3 signals, recommended-action chips, and (if present) a draft-message preview. Filters: agent, severity, status, entity type.
- Per-card actions (all `crudAction`-wrapped):
  - **Acknowledge** (no message) → status `ACKNOWLEDGED`.
  - **Take action** → opens the linked tool (`/admin/dispatch`, `/admin/applications/[id]`, etc.); records `ACTIONED`.
  - **Edit & approve draft** → editable preview, then **Send now** (calls `sendTemplate`/`sendText`); status `APPROVED`→`SENT`.
  - **Reject draft** / **Dismiss recommendation** with reason.
- `/admin/ops-agents/runs` — run history (status, counts, errors) with a **"Run review now"** button per agent (manual trigger, role-gated).
- `/admin/ops-agents/briefings` — daily briefings, newest first, rendered Markdown + metric tiles.
- Draft cards must visually distinguish `BLOCKED_POLICY` (greyed, "cannot send — opted out / no session") from `PENDING_APPROVAL`.
- Phase 3 only: per-agent **auto-send toggle** + per-template allowlist on `/admin/ops-agents/settings`, each writing a `FeatureFlag` and surfacing an explicit "automated sending is ON" banner.

---

## 6. WhatsApp message draft requirements

- **Draft, never auto-send (Phase 1–2).** Agents write `OpsDraftMessage`; the only send path is the admin approval action.
- **Template-first.** Outside an open 24h customer-care session, only registered `UTILITY`/`MARKETING` templates may be used. Freeform is allowed **only** when a live session is confirmed open for that number. The draft stores `templateName` + `templateParams`; `renderedPreview` is computed so ops sees the exact outgoing text.
- **New templates to register in Meta Business Manager + add to `TEMPLATES`** (`lib/messaging-templates.ts`):
  - `provider_application_more_info` (UTILITY) — "what to add to your application and why."
  - `provider_profile_coach` (MARKETING) — profile improvement nudge.
  - Reuse existing: `customer_abandoned_recovery`, `customer_review_request`, `provider_kyc_nudge`, `provider_invoice_send`, `please_confirm_with_provider`.
- **Policy gate.** At draft creation the runner calls `canSend(recipientPhone, templateName)`. If not allowed → `BLOCKED_POLICY` with `policyReason`; never surfaced as sendable. Re-check `canSend()` at send time (state may have changed).
- **Idempotency.** Reuse the existing sentinel-field pattern (e.g. don't re-draft a coaching nudge if `ProviderProfileScore.nudgedAt` within 14 days). On send, write `MessageEvent` via the existing `logOutboundMessage` and store `messageEventId` back on the draft.
- **Localisation hook.** Carry `preferredLanguage` (already on `ProviderApplication`) into `templateParams` so the right language template variant is chosen when available (ties into the localisation backlog).

---

## 7. OpenBrain logging design

Use the **in-app** writer (`lib/ai-loop/openbrain-writer.ts`), not the CLI. It already validates the taxonomy, redacts PII, and never throws.

| Moment | Call | Domain / type |
|---|---|---|
| Run start/finish | `safeCapture({ type:'ops.agent.run', agentKey, status, counts })` | `monitoring` |
| Each recommendation | `safeCapture({ type:'ops.recommendation', entity, classification, severity, signals })` | `monitoring` (or `improvement` for friction product-findings) |
| Draft approved & sent | `safeCapture({ type:'ops.draft.sent', recommendationId, template, recipientRole })` | `support` |
| Escalation (dispute/payment) | `safeCapture({ type:'ops.escalation', severity:'CRITICAL', ... })` | `monitoring` |
| Daily briefing | one consolidated `knowledge`-style entry; store returned `observationId` in `OpsDailyBriefing.openbrainRef` | `monitoring` |

Rules: never put raw `idNumber`, full phone, or message bodies in the OpenBrain payload — pass entity IDs and redacted summaries (the writer's `redactMetadata()` is a backstop, not a license). Per global CLAUDE.md, the daily briefing is the mandatory end-of-day knowledge entry; consolidate rather than spamming one entry per recommendation (follow the 7-day consolidation rule).

---

## 8. Security & POPIA / privacy considerations

1. **Special personal information** (`idNumber`, identity docs, `evidenceFileUrls`) never leaves the DB into OpenBrain or message previews. Application-review signals reference *presence/absence* ("ID number provided"), never the value.
2. **Consent before contact.** `canSend()` (opt-in state) gates every draft. Marketing-category coaching nudges require `whatsappMarketingOptIn`; service/utility messages require `whatsappServiceOptIn`. Honour `WhatsappPreferenceLog`.
3. **Purpose limitation.** Agents read only the fields needed for their evaluation; evaluators receive a minimised projection, not full records.
4. **Access control.** All agent routes and admin actions require `requireAdmin()`/`requireAdminApi()`; mutations go through `crudAction()` (role-checked + audited). Cron endpoints require the `CRON_SECRET` bearer. Auto-send (Phase 3) restricted to a dedicated role + flag.
5. **Auditability.** Every approve/send/dismiss writes `AdminAuditEvent` (who, when, what) via `crudAction`; every send writes `MessageEvent`. This is the POPIA accountability trail.
6. **Data minimisation in logs.** OpenBrain payloads carry IDs + redacted summaries only; message bodies live in `MessageEvent`, not OpenBrain.
7. **Right to object / opt-out** must immediately mark in-flight drafts to that recipient `BLOCKED_POLICY` (re-check at send time covers this).
8. **No detection-evasion / no dark patterns** in drafts; coaching copy is informative, not coercive.

---

## 9. Full implementation task list

Each task uses: **(1) Task · (2) Why · (3) Good output · (4) Acceptance criteria · (5) Risks/edge cases · (6) Files · (7) Data model · (8) Tests · (9) OpenBrain logging.**

### PHASE 1 — Instrument, persist, observe, recommend (no auto-send)

#### Task 1.1 — Add core Ops Agent schema + migration
1. Add models from §3 to `schema.prisma`; create an additive migration.
2. **Why:** every downstream task reads/writes these tables.
3. **Good output:** migration applies cleanly on preview branch; `prisma generate` types available; no drops/renames.
4. **Acceptance:** `pnpm prisma migrate status` clean; new models queryable; back-relations compile.
5. **Risks:** `@@unique([dedupeKey])` collisions if dedupeKey not stable — define it before coding runners. JSON columns default `[]`/`{}`.
6. **Files:** `field-service/prisma/schema.prisma`, `prisma/migrations/*`.
7. **Data model:** all of §3.
8. **Tests:** a migration smoke test that creates one row per model.
9. **OpenBrain:** none (schema only) — log the decision via `decision_add` ("Ops Agent data model added").

#### Task 1.2 — Agent framework: types, runner, OpenBrain bridge
1. Create `lib/ops-agents/types.ts` (§2 contract), `lib/ops-agents/runner.ts` (open run → load candidates → call evaluator → persist recs/drafts → `safeCapture` → close run), and `lib/ops-agents/openbrain.ts` (thin wrapper over `safeCapture`).
2. **Why:** shared spine so each agent is just a pure evaluator + a candidate loader.
3. **Good output:** `runAgent(agentKey, { trigger, window })` runs an evaluator over candidates idempotently and returns run summary.
4. **Acceptance:** runner upserts on `dedupeKey` (re-run updates, never duplicates); failures set run `PARTIAL/FAILED` with `error`; never throws to caller.
5. **Risks:** partial failure mid-batch must still close the run; clock injected for tests.
6. **Files:** `lib/ops-agents/{types,runner,openbrain}.ts`.
7. **Data model:** writes `OpsAgentRun`, `OpsRecommendation`, `OpsDraftMessage`.
8. **Tests:** runner with a stub evaluator — dedupe, partial-failure, counts.
9. **OpenBrain:** `ops.agent.run.start/finish` via `safeCapture`.

#### Task 1.3 — Provider Application Review evaluator (Agent A)
1. `lib/ops-agents/provider-application-review/evaluate.ts` (pure) + candidate loader.
2. **Why:** raise application quality before ops review; reduce back-and-forth.
3. **Good output:** completeness score, classification (§2.A), signals, ops recommendation, and a `provider_application_more_info` draft listing top missing items.
4. **Acceptance:** deterministic for fixed input; duplicate detection flags known collisions; West Rand area check correct; no auto-approve.
5. **Risks:** false `duplicate_or_suspicious` (legit re-applications) — make it advisory, never blocking. Pilot-area polygon must match `LocationNode` data.
6. **Files:** `lib/ops-agents/provider-application-review/*`; loader queries `ProviderApplication` since `windowFrom`.
7. **Data model:** none new (uses 1.1).
8. **Tests:** table-driven fixtures: complete, missing-pricing, out-of-area, duplicate, high-potential-incomplete.
9. **OpenBrain:** `ops.recommendation` (monitoring).

#### Task 1.4 — Service Request Friction instrumentation + evaluator (Agent C)
1. Emit `RequestFrictionSignal` at request stage regressions/abandonment in `BookingFlow.tsx` actions + `JobRequest` transitions; build `lib/ops-agents/service-request-friction/evaluate.ts` (per-request + aggregate).
2. **Why:** the friction product-findings are the highest-leverage output for the pilot.
3. **Good output:** dropoff-stage + reason per stuck request; period aggregate of top friction stages with counts.
4. **Acceptance:** every abandoned/declined/cancelled request yields a signal; aggregate matches raw counts; reasons derive from `DispatchDecision`/`MatchAttempt`/`Quote`/`Payment`.
5. **Risks:** double-counting on retries; define "abandoned" by inactivity threshold, not absence alone.
6. **Files:** `field-service/components/customer/BookingFlow.tsx`, `JobRequest` transition writers, `lib/ops-agents/service-request-friction/*`.
7. **Data model:** `RequestFrictionSignal` (1.1).
8. **Tests:** stage-mapping fixtures across each `JobRequestStatus`; aggregate rollup test.
9. **OpenBrain:** per-request `ops.recommendation`; aggregate findings in `improvement` domain.

#### Task 1.5 — Admin review inbox (read + acknowledge/dismiss)
1. Build `/admin/ops-agents` list + card UI (§5), Acknowledge/Dismiss/Take-action via `crudAction`. No send yet.
2. **Why:** ops visibility is the Phase-1 deliverable.
3. **Good output:** grouped, filterable inbox; actions update status + audit.
4. **Acceptance:** flag-gated; role-gated; `crudAction` writes `AdminAuditEvent`; `revalidatePath` refreshes.
5. **Risks:** large lists — paginate/`take`; `BLOCKED_POLICY` drafts clearly non-sendable.
6. **Files:** `app/(admin)/admin/ops-agents/{page,actions}.tsx`, components under `components/admin/ops-agents/`.
7. **Data model:** reads 1.1; updates `OpsRecommendation.status`.
8. **Tests:** Playwright smoke for `/admin/ops-agents` (extend `e2e/smoke.spec.ts`); action unit tests.
9. **OpenBrain:** `ops.recommendation.reviewed` on acknowledge/dismiss.

#### Task 1.6 — Manual "Run review now" + flags + seed
1. Admin-triggered runner endpoints (role-gated) + `/admin/ops-agents/runs`; seed flags `admin.ops_agents`, one per agent (`ops.agent.<key>`).
2. **Why:** lets ops/QA exercise agents before any cron exists.
3. **Acceptance:** button runs the agent, shows the run row; flags resolve via `lib/flags.ts`.
4. **Files:** `app/api/ops-agents/run/[agent]/route.ts`, `scripts/seed-flags.ts`, `app/(admin)/admin/ops-agents/runs/page.tsx`.
5. **Risks:** double-clicks → guard with a RUNNING-run lock.
6. **Data model:** `OpsAgentRun`.
7. **Tests:** route auth test; flag-resolution test.
8. **OpenBrain:** run lifecycle events.

### PHASE 2 — Scheduled + event triggers, coaching, friction analytics, stuck alerts

#### Task 2.1 — Cron runners for Agents A, C, D, E
1. Add `app/api/cron/ops-agents/<agent>/route.ts` (CRON_SECRET) + `vercel.json` schedules matching §2 cadences.
2. **Acceptance:** each cron calls `runAgent` with a time window from last successful run; idempotent; respects per-agent flag.
3. **Risks:** Vercel cron concurrency/timeout — chunk candidate batches; keep under function timeout.
4. **Files:** new cron routes; `field-service/vercel.json`.
5. **Tests:** route returns 401 without secret; windowing test.
6. **OpenBrain:** run events with `trigger:"cron"`.

#### Task 2.2 — Provider Profile Coach (Agent B) + improvement tracking
1. `lib/ops-agents/provider-profile-coach/*`, `ProviderProfileScore` snapshots, `provider_profile_coach` template, weekly cron.
2. **Acceptance:** attractiveness score persisted each run; nudge suppression (14d) enforced; `improvedSinceNudge` set when next snapshot beats the nudged one.
3. **Risks:** marketing opt-in required; don't nudge suspended/archived providers.
4. **Data model:** `ProviderProfileScore`.
5. **Tests:** score fixtures; suppression + improvement-detection tests.
6. **OpenBrain:** `ops.recommendation`; coaching outcome on improvement.

#### Task 2.3 — Matching Journey Monitor (Agent D) + stuck-request alerts
1. `lib/ops-agents/matching-journey-monitor/*`; SLA thresholds; emit ops alerts for breaches; recommended-action chips link to `/admin/dispatch`.
2. **Acceptance:** stuck requests detected at thresholds; severity scales with wait/value; no duplicate alerts within window.
3. **Risks:** alert fatigue — dedupe + escalate-on-worsening only.
4. **Files:** evaluator + monitor cron; optional `Case` link.
5. **Tests:** latency/threshold fixtures; dedupe test.
6. **OpenBrain:** `ops.escalation` for breaches.

#### Task 2.4 — Post-Match Follow-Up (Agent E) + closeout drafts
1. `lib/ops-agents/post-match-follow-up/*`; reuse `customer_review_request`/`provider_invoice_send`; CRITICAL escalations for disputes/payment failures.
2. **Acceptance:** incomplete-closeout detection across `Job`/`Payment`/`Dispute`; drafts created (not sent); money/dispute issues escalate.
3. **Risks:** don't nudge on already-closed jobs; respect idempotency sentinels.
4. **Tests:** closeout-state fixtures; escalation routing test.
5. **OpenBrain:** `ops.closeout`/`ops.escalation`.

#### Task 2.5 — Draft approval + send action
1. Approve/edit/send action in the inbox: re-check `canSend()`, call `sendTemplate`/`sendText`, write `MessageEvent`, store `messageEventId`, set draft `SENT`.
2. **Acceptance:** opted-out → blocked at send with clear error; success path writes audit + message event; double-send guarded.
3. **Risks:** template param mismatch with Meta — validate params against `TEMPLATES` before send.
4. **Files:** `app/(admin)/admin/ops-agents/actions.tsx`, uses `lib/whatsapp.ts`, `lib/message-events.ts`.
5. **Tests:** policy-block, success, double-send-guard.
6. **OpenBrain:** `ops.draft.sent`.

#### Task 2.6 — Friction analytics view
1. Aggregate `RequestFrictionSignal` into a trends panel on `/admin/ops-agents` (top stages/reasons over 7/30 days).
2. **Acceptance:** counts reconcile with raw rows; filter by period.
3. **Files:** analytics query + component.
4. **Tests:** rollup correctness.
5. **OpenBrain:** weekly friction summary in `improvement`.

### PHASE 3 — Semi-automated sending, approval flows, trend detection, feedback loops

#### Task 3.1 — Per-agent auto-send + per-template allowlist
1. `/admin/ops-agents/settings`; auto-send worker that sends `APPROVED`-equivalent drafts only when the agent's auto-send flag AND template allowlist are both on; dedicated role.
2. **Acceptance:** with flags off, behaviour identical to Phase 2; with on, only allowlisted templates auto-send, each still `canSend()`-checked and audited; explicit "automated sending ON" banner.
3. **Risks:** runaway sends — per-recipient + per-agent rate caps; kill-switch flag.
4. **Files:** settings page, `app/api/cron/ops-agents/auto-send/route.ts`.
5. **Tests:** flag-off no-send; rate-cap; allowlist enforcement.
6. **OpenBrain:** `ops.draft.auto_sent` with the governing flags recorded.

#### Task 3.2 — Trend detection & nudge feedback loop
1. Compare period-over-period agent metrics; for coaching, measure whether nudged providers improved (`improvedSinceNudge`) and whether improvement correlates with more leads/acceptances.
2. **Acceptance:** feedback metric per agent (nudge→outcome lift) surfaced in the briefing; trend deltas flagged.
3. **Files:** `lib/ops-agents/analytics/*`.
4. **Tests:** lift-computation fixtures.
5. **OpenBrain:** monthly trend entry in `monitoring`.

#### Task 3.3 — Ops Daily Briefing (Agent F)
1. `lib/ops-agents/ops-daily-briefing/*`; daily cron after other agents; write `OpsDailyBriefing` + one consolidated OpenBrain entry; `/admin/ops-agents/briefings`.
2. **Acceptance:** one briefing per day (`@@unique(forDate)`); includes all §F sections; `openbrainRef` stored.
3. **Risks:** must run after per-entity agents — schedule ordering.
4. **Tests:** aggregation fixtures; idempotent re-run for same date.
5. **OpenBrain:** consolidated `monitoring` knowledge entry (honours 7-day consolidation rule).

---

## 10. Acceptance criteria for the full feature

1. All six agents run via cron **and** manual trigger, idempotently, behind individual flags.
2. Every observation, recommendation, draft, and send is persisted **and** logged to OpenBrain through `safeCapture()`, with no special personal information in OpenBrain payloads.
3. **No WhatsApp message reaches a recipient without** either an explicit admin approval (Phase 1–2) or an explicitly enabled per-agent auto-send + per-template allowlist (Phase 3); every send passes `canSend()` and is recorded in `MessageEvent` + `AdminAuditEvent`.
4. The admin console at `/admin/ops-agents` shows a reviewable inbox, run history, friction trends, and daily briefings; all mutations are `crudAction`-audited and role/flag-gated.
5. Evaluators are pure and unit-tested with fixtures; Playwright smoke covers the new admin routes.
6. Schema changes are additive only; migrations apply cleanly on the preview branch.
7. POPIA: consent-gated contact, data minimisation, full audit trail, immediate opt-out honouring.
8. A measurable feedback loop exists for at least the profile-coach agent (nudge → improvement → lead lift).

---

## 11. Suggested order of implementation

1. **1.1 schema** → **1.2 framework/runner/OpenBrain bridge** (the spine; nothing else works without it).
2. **1.3 Application Review** + **1.4 Friction instrumentation** (highest pilot value, lowest risk — observe only).
3. **1.5 admin inbox** + **1.6 manual run + flags + seed** (close the Phase-1 loop: observe → review).
4. **2.1 cron runners** (turn observation continuous).
5. **2.2 Profile Coach**, **2.3 Matching Monitor**, **2.4 Post-Match Follow-Up** (broaden coverage).
6. **2.5 draft approval + send** (first real outbound, human-approved) → **2.6 friction analytics**.
7. **3.1 auto-send governance** → **3.2 trend/feedback loops** → **3.3 Daily Briefing** (capstone summary on top of everything).

Ship each agent and each auto-send path behind its own flag and flip them independently (House rule #5). Keep Playwright smoke aligned with the new routes (House rule #6).
