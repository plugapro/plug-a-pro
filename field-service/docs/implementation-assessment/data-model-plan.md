# Plug A Pro — Shared Data Model Assessment

**Assessed:** 2026-05-07
**Schema source:** `prisma/schema.prisma` (validated — `prisma validate` passes)
**Total migration count:** 74 applied migrations
**Latest migration:** `20260508010000_add_provider_application_contact_and_reference_fields`

---

## Summary

The current schema is mature and covers the vast majority of the blueprint target fields. All core entities exist. The most significant gaps are:

1. **Provider first/last name split** — `Provider.name` is a single string; no `firstName`/`lastName` split exists.
2. **`ProviderWallet` cached balance columns** — blueprint calls for `available_credits`, `starter_credits`, `purchased_credits`, `reserved_credits`. Current schema uses `paidCreditBalance` and `promoCreditBalance`; `reservedCreditBalance` is intentionally deferred per inline comment.
3. **`WalletLedgerEntry` blueprint fields** — several required idempotency/trace/balance columns use different names or are absent (`idempotency_key` exists as `idempotencyKey` on `ProviderLeadResponse` only; ledger lacks `idempotencyKey`, `traceId`, `balanceBefore`, `balanceAfter`, `starterBalanceAfter`, `purchasedBalanceAfter`, `requestId`, `jobId`, `leadInviteId`, `reason`, `source`).
4. **`TechnicianAvailability` weekend field** — `weekendAvailable` is missing (only `emergencyAvailable` and `sameDayAvailable` exist).
5. **`ProviderApplication.payoutVerifiedAt`** — present in the CLAUDE.md Provider field list but absent in the current schema.

Everything else in the blueprint either maps directly to an existing field (possibly under a different column name) or has an equivalent that satisfies the functional requirement.

---

## Entity-by-Entity Comparison

### Provider

| Blueprint field | Schema column | Status |
|---|---|---|
| `id` | `id` | ✅ |
| `user_id` | `userId` | ✅ |
| `mobile_e164` | `phone` | ✅ (different name, same E.164 contract) |
| `email` | `email` | ✅ |
| `status` | `status: ProviderStatus` | ✅ |
| `profile_photo` | `avatarUrl` | ✅ (different name) |
| `bio` | `bio` | ✅ |
| `provider_type` | — | ⚠️ ABSENT — no enum/field distinguishing sole-trader vs company |
| `approved_at` | — | ⚠️ ABSENT — onboarding approval timestamp not stored on Provider |
| `suspended_at` | `suspendedUntil` | ⚠️ PARTIAL — `suspendedUntil` is a future date, not an event timestamp |
| `suspended_reason` | `suspendedReason` | ✅ |
| `first_name` / `last_name` | — | ⚠️ ABSENT — single `name` field only |
| `payoutVerifiedAt` | — | ⚠️ ABSENT (listed in CLAUDE.md inventory but not in schema) |

**Assessment:** 9/14 fully present. 5 gaps. The critical functional gap is `approved_at` (needed for SLA reporting on the 30-min approval target) and the first/last name split (needed for formal communications). `provider_type` is minor — current model treats all providers as equivalent.

---

### ProviderCategories → `ProviderCategory`

| Blueprint field | Schema column | Status |
|---|---|---|
| `provider_id` | `providerId` | ✅ |
| `category` | `categorySlug` | ✅ |
| `sub_services` | `subServices: String[]` | ✅ |
| `years_experience` | `yearsExperience` | ✅ |
| `skill_level` | `skillLevel` | ✅ |
| `certification_required` | `certificationRequired` | ✅ |
| `certification_status` | `certificationStatus` | ✅ |

**Assessment:** Fully covered. `approvalStatus` is a bonus field.

---

### ProviderServiceAreas → `TechnicianServiceArea`

| Blueprint field | Schema column | Status |
|---|---|---|
| `province` | `province` | ✅ |
| `region` | `regionKey` | ✅ |
| `city` | `city` / `cityKey` | ✅ |
| `suburb` | `suburbKey` | ✅ (via suburbKey) |
| `normalized_suburb` | `label` | ⚠️ PARTIAL — `label` stores display name; normalised key is `suburbKey` |
| `travel_radius_km` | `radiusKm` | ✅ |
| `active` | `active` | ✅ |

**Assessment:** Functionally complete. `normalized_suburb` as a separate column is not strictly needed since `suburbKey` serves that purpose.

---

### ProviderAvailability → `TechnicianAvailability`

| Blueprint field | Schema column | Status |
|---|---|---|
| `day_of_week` | — | ⚠️ ABSENT on `TechnicianAvailability` — per-day schedule is on `ProviderSchedule` |
| `start_time` / `end_time` | — | ⚠️ ABSENT on `TechnicianAvailability` — on `ProviderSchedule` |
| `same_day_available` | `sameDayAvailable` | ✅ |
| `emergency_available` | `emergencyAvailable` | ✅ |
| `weekend_available` | — | ⚠️ ABSENT |

**Note:** Day-of-week schedule (day + start/end time) is split into `ProviderSchedule` (one row per day). `TechnicianAvailability` is an availability-state/mode model, not a schedule model. The blueprint conflates these two concerns. The functional requirement is met across both tables, but `weekendAvailable` is a genuinely missing boolean on `TechnicianAvailability`.

---

### ProviderRates → `ProviderRate`

| Blueprint field | Schema column | Status |
|---|---|---|
| `call_out_fee` | `callOutFee` | ✅ |
| `hourly_rate` | `hourlyRate` | ✅ |
| `day_rate` | `dayRate` | ✅ |
| `rate_negotiable` | `rateNegotiable` | ✅ |
| `quote_after_inspection` | `quoteAfterInspection` | ✅ |

**Assessment:** Fully covered. Schema adds `emergencySurcharge` as a bonus.

---

### ServiceRequests → `JobRequest`

| Blueprint field | Schema column | Status |
|---|---|---|
| `request_ref` | `requestRef` | ✅ |
| `category_id` | — | ⚠️ ABSENT — `category` is a string slug; no FK to `Category.id` |
| `subcategory_id` | `subcategory` | ⚠️ PARTIAL — stored as string, not FK to a subcategory model |
| `urgency` | `urgency` | ✅ |
| `preferred_date` | `requestedWindowStart` | ✅ (via window fields) |
| `preferred_time_window` | `requestedWindowStart` / `requestedWindowEnd` | ✅ |
| `budget_preference` | `budgetPreference` | ✅ |
| `max_call_out_fee` | `maxCallOutFee` | ✅ |
| `provider_preference` | `providerPreference` | ✅ |
| `verified_only` | `verifiedOnly` | ✅ |
| `risk_level` | `riskLevel` | ✅ |
| `certified_provider_required` | `certifiedProviderRequired` | ✅ |

**Assessment:** 10/12 covered. The two gaps (`category_id` FK and `subcategory_id` FK) are intentional design deference — categories are string slugs not managed FK rows. If the `Category` model is intended to normalise category references, `JobRequest.categoryId` should be added. This is a **product decision**, not a schema error.

---

### LeadInvites → `Lead`

| Blueprint field | Schema column | Status |
|---|---|---|
| `match_score` | `matchScore` | ✅ |
| `ranking_position` | `rankingPosition` | ✅ |
| `safe_preview_token` | `safePreviewToken` | ✅ |
| `viewed_at` | `viewedAt` | ✅ |
| `responded_at` | `respondedAt` | ✅ |

**Assessment:** Fully covered.

---

### ProviderLeadResponses → `ProviderLeadResponse`

| Blueprint field | Schema column | Status |
|---|---|---|
| `lead_invite_id` | `leadInviteId` | ✅ |
| `call_out_fee` | `callOutFee` | ✅ |
| `estimated_arrival_at` | `estimatedArrivalAt` | ✅ |
| `rate_type` | `rateType` | ✅ |
| `rate_amount` | `rateAmount` | ✅ |
| `negotiable` | `negotiable` | ✅ |
| `provider_note` | `providerNote` | ✅ |

**Assessment:** Fully covered. Schema also carries `idempotencyKey` and `source` as bonuses.

---

### Shortlists → `ProviderShortlist` + `ProviderShortlistItem`

| Blueprint field | Schema column | Status |
|---|---|---|
| `request_id` | `ProviderShortlist.requestId` | ✅ |
| `status` | `ProviderShortlist.status` | ✅ |
| `published_at` | `ProviderShortlist.publishedAt` | ✅ |
| `item rank` | `ProviderShortlistItem.rank` | ✅ |
| `display_call_out_fee` | `ProviderShortlistItem.displayCallOutFee` | ✅ |
| `display_arrival_time` | `ProviderShortlistItem.displayArrivalTime` | ✅ |
| `customer_selected_at` | `ProviderShortlistItem.customerSelectedAt` | ✅ |

**Assessment:** Fully covered.

---

### Jobs → `Job`

| Blueprint field | Schema column | Status |
|---|---|---|
| `job_ref` | `jobRef` | ✅ |
| `scheduled_arrival_at` | `scheduledArrivalAt` | ✅ |
| `arrival_time_confirmed_at` | `arrivalTimeConfirmedAt` | ✅ |

**Assessment:** Fully covered.

---

### CreditLedger → `WalletLedgerEntry`

| Blueprint field | Schema column | Status |
|---|---|---|
| `idempotency_key` | — | ⚠️ ABSENT |
| `trace_id` | — | ⚠️ ABSENT |
| `balance_before` | — | ⚠️ ABSENT — only `balanceAfterPaidCredits` / `balanceAfterPromoCredits` |
| `balance_after` | `balanceAfterPaidCredits` + `balanceAfterPromoCredits` | ⚠️ PARTIAL — split by type, no single combined field |
| `starter_balance_after` | — | ⚠️ ABSENT — promo credits cover this concept but not exactly |
| `purchased_balance_after` | — | ⚠️ ABSENT — `balanceAfterPaidCredits` is the closest; naming is different |
| `request_id` | — | ⚠️ ABSENT — `referenceType`/`referenceId` are generic; no typed FK |
| `job_id` | — | ⚠️ ABSENT — same: absorbed in generic reference fields |
| `lead_invite_id` | — | ⚠️ ABSENT — absorbed in generic reference fields |
| `reason` | `description` | ⚠️ PARTIAL — `description` is a free-text field; blueprint implies a reason code |
| `source` | — | ⚠️ ABSENT |

**Assessment:** The existing model uses a generic `referenceType`/`referenceId` pair instead of typed FK columns. This is a deliberate design choice — it keeps the ledger schema stable when new reference types are added. However it sacrifices typed queries. The `idempotencyKey` is the most critical missing field for payment safety.

---

### CreditBalances → `ProviderWallet`

| Blueprint field | Schema column | Status |
|---|---|---|
| `available_credits` | — | ⚠️ PARTIAL — `paidCreditBalance + promoCreditBalance` = available; no single column |
| `starter_credits` | `promoCreditBalance` | ⚠️ PARTIAL — promo credits cover this concept; not explicitly named `starter_credits` |
| `purchased_credits` | `paidCreditBalance` | ⚠️ PARTIAL — same concept, different name |
| `reserved_credits` | — | ⚠️ INTENTIONALLY DEFERRED — inline comment in schema explains why |

**Assessment:** Functionally equivalent but naming diverges from the blueprint. `reservedCreditBalance` is explicitly deferred by code comment; the other renames are stable and consistent throughout the codebase.

---

## Missing Fields — Safe Additive Migration Plan

### Tier 1 — Critical (add now)

| Field | Table | Reason |
|---|---|---|
| `approvedAt DateTime?` | `providers` | Required for 30-min approval SLA reporting |
| `idempotencyKey String? @unique` | `wallet_ledger_entries` | Prevents duplicate credit operations under retries |
| `weekendAvailable Boolean @default(false)` | `technician_availability` | Matching filter completeness |

### Tier 2 — Recommended (add in next sprint)

| Field | Table | Reason |
|---|---|---|
| `firstName String?` | `providers` | Formal comms, salutation in WhatsApp templates |
| `lastName String?` | `providers` | Same as above |
| `providerType String?` | `providers` | Sole-trader vs company distinction for compliance |
| `traceId String?` | `wallet_ledger_entries` | Distributed tracing across payment + credit operations |
| `source String?` | `wallet_ledger_entries` | Audit trail: `"admin"` \| `"system"` \| `"payment_intent"` |
| `categoryId String?` | `job_requests` | FK to `Category.id` — enables category-level reporting |

### Tier 3 — Low priority / product decision required

| Field | Table | Reason |
|---|---|---|
| `subcategoryId String?` | `job_requests` | Requires a `Subcategory` model that doesn't exist yet |
| `payoutVerifiedAt DateTime?` | `providers` | Listed in CLAUDE.md inventory; may have been missed |

---

## Privacy-Sensitive Fields

| Field | Table | Risk | Recommendation |
|---|---|---|---|
| `idNumber` | `provider_applications` | POPIA §26 — national ID stored plaintext | Encrypt at rest before GA. Schema comment acknowledges this. **Do not log, export, or return in API responses.** |
| `phone` | `providers`, `customers` | E.164 mobile — PII | Already stored without encryption; acceptable for SA domestic operators but document in PAIA compliance register |
| `accessNotes` | `addresses` | Gate codes, building access details — access-sensitive | Schema comment correctly marks this; server-side preview renderers must honour the `Lead.safePreviewToken` gate |
| `lastKnownLat` / `lastKnownLng` | `providers` | Precise location — PII | Acceptable for operational use; ensure no public API exposes raw coordinates |
| `data Json` | `conversations` | WhatsApp bot session accumulates PII during onboarding | Apply TTL purge; `expiresAt` exists but purge job not confirmed |

---

## Index Recommendations

| Table | Suggested index | Reason |
|---|---|---|
| `providers` | `(status, createdAt)` | Onboarding queue — filter by APPLICATION_PENDING ordered by createdAt |
| `providers` | `(kycStatus, status)` | KYC reporting queries |
| `wallet_ledger_entries` | `(idempotencyKey)` — after adding the column | Idempotency check on credit write |
| `leads` | `(safePreviewToken)` — unique already implied | Confirm unique index exists (it's declared `@unique`) ✅ |
| `job_requests` | `(categoryId, status)` — after adding the column | Category-level request reporting |
| `provider_applications` | `(status, submittedAt)` | Admin review queue ordering |

The `(status, submittedAt)` index on `provider_applications` and `(status, createdAt)` on `providers` are both missing and would be high-value for the admin queue.

---

## Migration Plan (additive only — no drops, no renames)

All proposed changes are `nullable` fields or fields with defaults. Zero breaking changes.

### Migration 1: `add_provider_approved_at_and_type`

```sql
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "providerType" TEXT,
  ADD COLUMN IF NOT EXISTS "firstName" TEXT,
  ADD COLUMN IF NOT EXISTS "lastName" TEXT,
  ADD COLUMN IF NOT EXISTS "payoutVerifiedAt" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "providers_status_created_at_idx" ON "providers" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "providers_kycStatus_status_idx" ON "providers" ("kycStatus", "status");
CREATE INDEX IF NOT EXISTS "provider_applications_status_submitted_at_idx" ON "provider_applications" ("status", "submittedAt");
```

### Migration 2: `add_wallet_ledger_idempotency_and_trace`

```sql
ALTER TABLE "wallet_ledger_entries"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "traceId" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT;
```

### Migration 3: `add_technician_availability_weekend`

```sql
ALTER TABLE "technician_availability"
  ADD COLUMN IF NOT EXISTS "weekendAvailable" BOOLEAN NOT NULL DEFAULT false;
```

### Migration 4 (conditional — if category FK normalisation approved): `add_job_request_category_id`

```sql
ALTER TABLE "job_requests"
  ADD COLUMN IF NOT EXISTS "categoryId" TEXT REFERENCES "categories"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "job_requests_categoryId_status_idx" ON "job_requests" ("categoryId", "status");
```

> **Note:** Migration 4 requires a product decision on whether `JobRequest.category` (string slug) will eventually be deprecated in favour of the FK. Do not run it until that decision is made and existing `category` slug data is back-filled to `Category.id` values.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `idNumber` stored plaintext | High | Encrypt at rest before GA; field-level AES-256 or Supabase vault secret. Track as a security ticket. |
| `WalletLedgerEntry` lacks `idempotencyKey` | High | Any retry of a credit write can produce duplicates. Add Migration 2 before first real-money topup. |
| `Provider.approvedAt` missing | Medium | 30-min SLA cannot be reported accurately. `ProviderApplication.reviewedAt` approximates it but is not on the Provider row itself. Add Migration 1. |
| Stale `CandidatePool` not purged | Medium | If provider is suspended/archived, their `CandidatePool` rows remain until next cron refresh. Add soft-delete cascade or purge on status change. |
| `Conversation.data` purge job | Medium | Session data may accumulate PII indefinitely if the background purge job isn't running. Verify `expiresAt`-based cleanup exists and runs. |
| `ProviderWallet` naming vs blueprint | Low | `paidCreditBalance` vs `purchased_credits` etc. Naming is inconsistent with blueprint but internally consistent. Document the mapping; no migration needed. |
| Category FK migration (Migration 4) | Low | Back-fill complexity — existing `category` slugs must resolve to `Category.id` before FK can be enforced. Treat as a separate sprint task. |

---

## OpenBrain Note

This document was produced by CODEX Step 03. Key outcomes:

- Schema validated clean (`prisma validate` passes).
- 3 Tier-1 additive migrations identified: `approvedAt` on `providers`, `idempotencyKey` on `wallet_ledger_entries`, `weekendAvailable` on `technician_availability`.
- 1 privacy risk escalated: `idNumber` plaintext storage requires encryption before GA.
- No breaking changes proposed; all additions are nullable or have safe defaults.
- Next step: run `npx prisma migrate dev --name add_provider_approved_at_and_type --create-only` to generate the SQL files, review, then apply.
