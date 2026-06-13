# Plug-A-Pro AI Operating Loop

_Status: MVP foundation (2026-06-13). Implementation lives in `lib/ai-loop/`._

This document describes Plug-A-Pro's AI-native operating loop: a safe, reviewable
feedback system that makes the platform legible to AI and turns recurring
operational pain into human-approved improvement work. It is built on **OpenBrain**
(the company brain — the markdown knowledge store at repo-root `openbrain/`).

> **This is not an autonomous production system.** The loop only **observes**,
> **classifies**, and **prepares reviewable task instructions**. It never deploys,
> never changes payment/KYC/security logic, never runs migrations, and never acts
> on production data. Every change it suggests goes through a human.

---

## 1. Why this exists

Plug-A-Pro is a WhatsApp-first field-service marketplace. Signal about what is
breaking or causing friction is scattered across audit logs, error events,
message logs, and people's heads. The loop captures that signal in a **safe,
structured, AI-legible** form so we can:

- spot recurring failures/friction early (product, support, ops),
- convert them into well-scoped, guard-railed Claude Code task briefs,
- keep a durable institutional memory in OpenBrain,
- do all of the above **without** leaking PII or enabling unsafe automation.

## 2. The loop

```
 ┌── 1. Sensor ──────┐   ┌── 2. Policy ───────┐   ┌── 3. Tool ─────────┐
 │ Platform emits a  │ → │ validate · reject  │ → │ writeOperational   │
 │ typed Operational │   │ unsafe · redact    │   │ Event → OpenBrain  │
 │ Event (taxonomy)  │   │ (events/redaction) │   │ sink (degrades safe)│
 └───────────────────┘   └────────────────────┘   └─────────┬──────────┘
                                                             │ observations
 ┌── 5. Learning ────┐   ┌── 4. Quality gate ─┐             ▼
 │ improvement       │ ← │ human-review-policy │ ←── repeated patterns
 │ candidates (briefs│   │ (risk + gating)     │
 │ + draft CC tasks) │   └─────────────────────┘
 └─────────┬─────────┘
           ▼ admin read-only view  → human approves → Claude Code task (separate)
```

| Layer | Module | Responsibility |
|---|---|---|
| 1. Sensor | `taxonomy.ts`, `events.ts` | Define the typed events the platform may emit. |
| 2. Policy | `events.ts`, `redaction.ts` | Validate, reject raw secrets/PII, redact soft PII. |
| 3. Tool | `openbrain-writer.ts`, `sink.ts` | Safely persist observations; degrade if storage is down. |
| 4. Quality gate | `human-review-policy.ts` | Classify change risk; decide what needs human review. |
| 5. Learning | `improvement-candidates.ts` | Turn repeated signal into reviewable candidates. |
| Visibility | `admin-view.ts` + `GET /api/admin/improvement-candidates` | Read-only admin triage. |

The loop sits **downstream** of the systems of record. It does **not** replace:

- `lib/audit.ts` / `AuditLog` — the legal/operational audit trail of admin actions,
- `lib/application-error-service.ts` / `ApplicationErrorEvent` — the error store,
- `SecurityEvent` — the security system of record.

Those remain authoritative. The loop only ever sees safe, derived signal and
keeps a **learning** log — never confuse the two.

## 3. What gets captured

Only events defined in the **taxonomy** (`lib/ai-loop/taxonomy.ts`). Each event
has a stable name, category, default severity, allowed actor types, redaction
profile, and two flags: `openBrainEligible` and `improvementCandidateEligible`.

Categories: `auth`, `customer_request`, `service_search`, `matching`, `quote`,
`booking`, `payment`, `voucher`, `provider_onboarding`, `kyc`, `whatsapp`,
`notification`, `job_execution`, `admin_action`, `security`, `system_error`,
`campaign`, `support`, `improvement_candidate`.

An **OperationalEvent** carries: the event name, actor type, an optional
**reference** to the actor (internal id; hashed if phone-like), **entity
references** (internal ids only), the affected business flow, an ISO timestamp,
and **safe metadata** (codes, counts, statuses — not prose, not documents).

### Events that produce observations
Any `openBrainEligible` event that passes validation becomes an
`ObservationRecord` in OpenBrain (NDJSON under `openbrain/observations/`).

### Events that can seed improvement candidates
Only `improvementCandidateEligible` events with a matching rule in
`improvement-candidates.ts` — e.g. `booking.failed`, `payment.failed`,
`kyc.document_upload_failed`, `whatsapp.message_delivery_failed`,
`matching.no_providers`, `matching.provider_accepted_no_response`,
`quote.approval_abandoned`, `admin_action.manual_workaround`,
`auth.state_inconsistent`, `system_error.legal_link_broken`,
`system_error.frontend_high_severity`.

## 4. What must never be captured raw

These are **rejected** (the event is refused, not silently scrubbed) when present
as a populated field — failing loud forces the call site to stop sending them:

ID/passport/permit numbers · selfies · document photos · biometric/liveness data ·
payment-card data (PAN/CVV) · access/refresh/ID tokens · bearer/authorization
headers · session cookies · secrets/API keys/private keys · raw passwords · raw
OTPs/PINs.

The non-negotiable gate is `findRawSensitiveFields()` (deny-tier key fragments in
`redaction.ts`), enforced by both `validateEvent()` and `writeOperationalEvent()`.

## 5. How sensitive data is redacted

| Tier | Examples | Action |
|---|---|---|
| **Deny** | tokens, secrets, gov-id, biometrics, card data, OTP, password | **Reject the event.** (Defense-in-depth: any that slip through render as `[REJECTED]`.) |
| **Soft** | phone, email | **Mask** (`maskPhone` → `082****567`, `maskEmail` → `l***@domain`). |
| **Free text** | message bodies, notes, addresses, reasons | **Summarise** to `[text omitted: N chars]`; scrub embedded 13-digit IDs and long tokens. |
| **References** | actor/entity ids | Internal ids pass through; phone-like values are **hashed** (`phash_…`). |

This mirrors the proven redaction in `lib/application-error-service.ts`
(`REDACT_KEYS` + recursive `redactPayload` + sha256), kept consistent platform-wide.
WhatsApp/KYC/auth events use the **strict** profile: any unexpected long string is
treated as a possible message body and summarised. **No WhatsApp message bodies,
documents, or selfies are ever stored.**

## 6. How OpenBrain entries are structured

**Observation** (`ObservationRecord`, NDJSON in `openbrain/observations/`):
`id`, `event`, `category`, `severity`, `actorType`, `actorRef` (safe),
`entityRefs` (safe), `affectedFlow`, `occurredAt`, `recordedAt`, redacted
`metadata`, `isTestEvent`.

**Improvement candidate** (`ImprovementCandidate`): persisted as NDJSON **and** a
human-readable markdown brief in `openbrain/improvement-candidates/<id>.md`
(matching the existing `openbrain/engineering/*` convention). Fields: `title`,
`problemSummary`, `affectedFlow`, `category`, `evidenceCount`, `exampleRefs`
(safe), `suspectedCause`, `suggestedInvestigation`, `riskLevel`,
`recommendedOwnerRole`, `humanReviewRequired`, `draftTaskInstruction`,
`createdAt`, `status`.

The sink is pluggable (`memory` / `file` / `null`) and resolved from env:
`OPENBRAIN_STORE_DIR` (file sink path), `OPENBRAIN_AILOOP_SINK=null` (opt-out),
default file sink at `<cwd>/../openbrain`. **The writer never throws** — if the
store is unavailable (e.g. read-only serverless FS) it logs and moves on, so a
logging failure can never block a customer/payment/job flow.

## 7. Human-review gating (the quality gate)

Risk is classified by **change area** (`human-review-policy.ts`), **fail-safe by
default** — anything unknown requires review at `high` risk.

**Always require human review (gated):**
production deploys · payment logic · KYC logic · security/auth/RBAC · database
migrations · data deletion · provider activation/deactivation · customer refunds ·
voucher/credit balance changes · outbound bulk WhatsApp campaigns ·
privacy/POPIA-impacting changes · anything touching secrets/credentials.

**Lower-risk (still owned by a human, not gated as high-risk):**
documentation updates · test additions · internal dashboard changes ·
read-only reporting improvements.

A candidate's `humanReviewRequired` flag and `riskLevel` are derived from the
affected flow via `areaForFlow()` → `classifyChangeRisk()`. Payment/KYC/auth flows
are forced to `critical`.

### What Claude Code may safely automate (after a human approves the candidate)
Read-only reporting, docs, tests, internal dashboards, and investigation/diagnosis
work — opening a PR for review.

### What Claude Code must never automate without review
Everything in the gated list above. The generated `draftTaskInstruction` embeds
these guardrails verbatim ("Do NOT deploy to production", "Do NOT change
payment/KYC/auth/security logic… without explicit human approval", "Add tests").

## 8. Admin visibility

`GET /api/admin/improvement-candidates` (ADMIN/OWNER only, read-only) returns the
triage columns: `title`, `category`, `riskLevel`, `status`, `affectedFlow`,
`evidenceCount`, `createdAt`, `recommendedOwnerRole`, `humanReviewRequired`. There
is **no** create/update/delete endpoint — acting on a candidate is a separate,
human-driven step. (UI surface in the admin console is a documented follow-up.)

## 9. How this supports each function

- **Product** — quote abandonment, no-provider gaps, repeated manual workarounds →
  scoped product candidates.
- **Support** — recurring issue themes and escalations become tracked candidates
  instead of tribal knowledge.
- **Operations** — WhatsApp delivery failures, notification failures, onboarding
  stalls surface with evidence counts.
- **Security** — auth-state inconsistencies and security events are observed
  (referencing, never duplicating, `SecurityEvent`); any fix stays human-gated.
- **Engineering** — high-severity frontend/backend errors and booking/payment
  failures arrive as ready-to-triage briefs with safe references and an
  investigation path.

## 10. Risks & how they are handled

| Risk | Mitigation |
|---|---|
| Leaking PII via metadata | Deny-tier rejection + soft redaction + free-text summarisation + embedded-pattern scrub. |
| Logging tokens in raw error payloads | Deny-tier keys rejected; long token/ID patterns scrubbed from strings. |
| Blocking journeys if OpenBrain is down | Writer never throws; sink failures are non-fatal. |
| Noisy one-off candidates | Per-rule minimum evidence threshold (default 3); below-threshold groups ignored. |
| Vague, evidence-free candidates | Candidates with no safe reference are dropped. |
| Mis-rating payment/KYC/security as low risk | Fail-safe classifier; payment/KYC/auth forced to critical + gated. |
| Confusing audit logs with the learning log | Loop is downstream and separate; systems of record untouched. |
| Duplicate candidates across runs | Deterministic candidate id per `(event, flow)`. |

## 11. Follow-up work (not in this MVP)

1. **Wire sensors** into real flows (`void safeCapture({...})` at booking/payment/
   KYC/WhatsApp/matching failure points). MVP ships the library + safe writer; no
   hot paths were rewired.
2. **Admin UI** for the candidate list (the read endpoint exists).
3. **Scheduled aggregation** job (cron) to run `generateImprovementCandidates`
   over a rolling window and persist candidates.
4. **Observation dedupe** keys to suppress duplicate captures of the same incident.
5. Optional: mirror selected candidates into the OpenBrain CLI knowledge base.
