# Identity verification fail-safe — no concurrent submissions, hard 3-attempt cap

**Date:** 2026-05-26
**Status:** Awaiting user review
**Trigger:** Lovemore Sibanda (`b6b91902-…`) has 4 verification rows in production — 1 PASSED, 1 NEEDS_MANUAL_REVIEW, 2 AWAITING_DOCUMENT. He shouldn't have been able to create more than 1.

## Context

The current creation logic has a per-channel "reuse non-terminal" check in `lib/identity-verification/link.ts:63-71`, but the WhatsApp flow in `lib/whatsapp-flows/identity-verification.ts:85-95` creates unconditionally on every consent tap. Cross-channel concurrency isn't blocked either. There's no per-provider attempt cap. The result: providers can stack up arbitrary numbers of verification rows by re-consenting in WhatsApp or hopping between channels, each one consuming ops-review queue space and confusing the operator's view of the case.

Stated intent (decided with user):
- **Concurrency:** at most one non-terminal verification per provider, across all channels
- **Attempt cap:** 3 attempts max. Cap is "declined attempts" = `FAILED` status only. EXPIRED / CANCELLED don't count.
- **Lock recovery:** support ticket only (hard lock). No self-service or admin-dashboard unlock for v1.
- **Backfill:** existing FAILED rows do NOT count toward the new cap. Reset for everyone on rollout.

## Two deliverables, sequenced

### 1. Immediate one-off cleanup — Lovemore Sibanda

Production fix that runs once, transactionally, and is irreversible.

**Target provider:** `b6b91902-b268-4bc3-9d16-0942a25c2d60` (Lovemore Sibanda)

**To delete (3 rows):**
| id | status | channel | created |
|---|---|---|---|
| `cmpl9tqhl000aju049p01q6zz` | NEEDS_MANUAL_REVIEW | PWA | 2026-05-25 13:57 |
| `cmplfn21i0006jr0433g0x3uk` | AWAITING_DOCUMENT | WhatsApp | 2026-05-25 16:40 |
| `cmplixlep0006ih04dy30uqji` | AWAITING_DOCUMENT | WhatsApp | 2026-05-25 18:12 |

**To keep (1 row):**
| `cmpm8xjru0006l5041fo3jzcc` | PASSED ✅ | WhatsApp | 2026-05-26 06:20 (reviewed by Lebogang) |

**Cascade rows that must be cleaned too** (in the same transaction, since FK constraints are RESTRICT-style):
- `provider_identity_documents` (one row per uploaded doc per verification)
- `provider_verification_reviews` (admin manual decisions on that verification)
- `provider_verification_webhook_events` (vendor callbacks) — if any exist for these rows
- `provider_identity_consent_events` and `provider_identity_security_events` — only if the production DB has these tables (the WIP schema adds them; check before delete)
- `provider_sensitive_data_access_logs` — likely keep these as audit trail (they reference the verification by ID but represent past access events; deleting them rewrites history). **Set FK to NULL or keep rows with stale verification id.**

**One-off script:** `field-service/scripts/cleanup-provider-identity-verifications.ts`. Takes `--provider-id <id>` and `--keep-status PASSED` flags. Always runs inside a transaction. Prints a dry-run summary first; only deletes when `--confirm` is passed. Writes an `AuditLog` row with `actorId = Lebogang's admin id`, `action = 'provider_identity_verification.cleanup'`, and the deleted verification ids in `before`.

### 2. Fail-safe rule — gate at the orchestrator layer

Single shared function. Both PWA (`link.ts`) and WhatsApp (`whatsapp-flows/identity-verification.ts:85`) call it before any `providerIdentityVerification.create({...})`.

#### Schema change

Add one column to `provider_identity_verifications`:
```prisma
countsTowardAttemptCap Boolean @default(true)
```
Migration backfills existing rows to `false`. New rows default to `true`. The gate counts only rows where `countsTowardAttemptCap = true AND status = 'FAILED'`. Adding an index on `(providerId, status, countsTowardAttemptCap)` keeps the gate query fast.

#### Gate function — `lib/identity-verification/gate.ts` (new)

```ts
export type VerificationStartCheck =
  | { ok: true }
  | { ok: false; reason: VerificationStartBlockReason; message: string }

export type VerificationStartBlockReason =
  | 'PROVIDER_ALREADY_VERIFIED'      // any PASSED row → no need to verify
  | 'VERIFICATION_IN_PROGRESS'       // any non-terminal row in any channel
  | 'VERIFICATION_LOCKED'            // 3+ FAILED post-cutoff → contact support

export async function checkCanStartNewVerification(
  providerId: string,
  opts?: { tx?: PrismaTransactionClient },
): Promise<VerificationStartCheck>
```

The gate runs a **single SELECT** that aggregates the relevant counts in one round-trip:
```sql
SELECT
  bool_or(status = 'PASSED') AS has_passed,
  bool_or(status NOT IN ('PASSED','FAILED','EXPIRED','CANCELLED')) AS has_in_progress,
  COUNT(*) FILTER (WHERE status = 'FAILED' AND "countsTowardAttemptCap" = true) AS counted_failures
FROM provider_identity_verifications
WHERE "providerId" = $1
```

Decision tree (in order — first match wins):
1. `has_passed = true` → `PROVIDER_ALREADY_VERIFIED`
2. `has_in_progress = true` → `VERIFICATION_IN_PROGRESS`
3. `counted_failures >= 3` → `VERIFICATION_LOCKED`
4. otherwise → `{ ok: true }`

#### Wiring

- `lib/identity-verification/link.ts:63-83`: replace the per-channel reuse-check with `await checkCanStartNewVerification(input.providerId)`; on block, throw a typed `ProviderIdentityVerificationLinkError` with `reason` carried through.
- `lib/whatsapp-flows/identity-verification.ts:85`: same gate call before the unconditional create; on block, send the mapped WhatsApp message and bail out cleanly (no row created).

#### User-facing messages

Mapped centrally so both surfaces stay in sync.

| Block reason | WhatsApp / PWA message |
|---|---|
| `PROVIDER_ALREADY_VERIFIED` | "Your identity is already verified — no action needed." |
| `VERIFICATION_IN_PROGRESS` | "You already have a verification in progress. Please complete or wait for that one to be reviewed before starting a new attempt." |
| `VERIFICATION_LOCKED` | "You've used all 3 verification attempts. For security reasons we can't accept another submission automatically. Please contact support so we can review your case manually." |

#### Feature flag

`provider.identity.verification.fail_safe` — defaults to **OFF**. Ships in deploy 1, flipped ON after we've verified the gate path against a test provider in production.

Per the house rule "every admin-facing feature ships behind a flag and is flipped separately" — this is provider-facing but the principle holds. While OFF, the gate function is still defined and tested, but creation entry points read the flag and skip the gate. This lets us roll back instantly if the gate over-blocks.

## Critical files to modify / create

| File | What changes |
|---|---|
| `field-service/prisma/schema.prisma` | + `countsTowardAttemptCap Boolean @default(true)` on `ProviderIdentityVerification`, + `@@index([providerId, status, countsTowardAttemptCap])` |
| `field-service/prisma/migrations/<new>/migration.sql` | ALTER TABLE + backfill `UPDATE … SET countsTowardAttemptCap = false WHERE "createdAt" < now()` + index |
| `field-service/lib/identity-verification/gate.ts` (new) | `checkCanStartNewVerification()` + types + messages |
| `field-service/lib/identity-verification/link.ts` | Replace the existing per-channel reuse-check with a gate call; honour the flag |
| `field-service/lib/whatsapp-flows/identity-verification.ts` | Call gate before unconditional create at line 85; honour the flag; render the mapped message |
| `field-service/lib/feature-flags-registry.ts` | + `provider.identity.verification.fail_safe` flag entry |
| `field-service/scripts/seed-flags.ts` | seed the new flag as disabled by default |
| `field-service/scripts/cleanup-provider-identity-verifications.ts` (new) | One-off cleanup script (dry-run by default, `--confirm` to commit) |
| `field-service/__tests__/lib/identity-verification/gate.test.ts` (new) | unit tests for the gate decision tree |
| `field-service/__tests__/lib/identity-verification/link.test.ts` | extend to assert the gate is called and block reasons surface as errors |
| `field-service/__tests__/lib/whatsapp-flows/identity-verification.test.ts` | extend to assert the WhatsApp consent handler bails out cleanly on each block reason with the mapped copy |

## Existing utilities to reuse (do NOT re-implement)

- `NON_TERMINAL_VERIFICATION_STATUSES` constant in `lib/identity-verification/types.ts` — already defines which statuses count as "in progress"
- `ProviderIdentityVerificationLinkError` in `lib/identity-verification/link.ts` — extend with the new reasons, don't introduce a parallel error class
- `transitionIdentityVerification` — keep the same; the gate runs *before* any transition or create, never replaces them
- The flag-reading helper in `lib/flags.ts` — same pattern as `admin.crud.verifications`, no new infrastructure
- `crudAction()` is NOT involved — the cleanup script writes directly to AuditLog using the same shape (`action`, `entityType`, `entityId`, `before`, `after`)

## Verification

### Unit tests — gate decision tree

- Provider with 0 records → `{ ok: true }`
- Provider with 1 PASSED → `PROVIDER_ALREADY_VERIFIED`
- Provider with 1 NEEDS_MANUAL_REVIEW + 0 PASSED → `VERIFICATION_IN_PROGRESS`
- Provider with 1 AWAITING_DOCUMENT in any channel + 0 PASSED → `VERIFICATION_IN_PROGRESS`
- Provider with 3 FAILED post-cutoff + 0 PASSED + 0 in-progress → `VERIFICATION_LOCKED`
- Provider with 2 FAILED post-cutoff + 0 in-progress + 0 PASSED → `{ ok: true }` (under cap)
- Provider with 5 FAILED pre-cutoff (countsTowardAttemptCap=false) + 0 post-cutoff + 0 in-progress → `{ ok: true }` (historic don't count)
- Provider with 2 FAILED post-cutoff + 1 NEEDS_MANUAL_REVIEW → `VERIFICATION_IN_PROGRESS` (in-progress beats cap, more actionable)
- Provider with 1 EXPIRED + 0 FAILED → `{ ok: true }` (EXPIRED doesn't count, doesn't block)
- Provider with 1 PASSED + 1 NEEDS_MANUAL_REVIEW (impossible but defensive) → `PROVIDER_ALREADY_VERIFIED` (PASSED beats everything)

### Integration tests

- `link.ts` integration: with flag ON, calling `linkProviderIdentityVerification` for a blocked provider throws `ProviderIdentityVerificationLinkError` with the right reason; no DB row created.
- WhatsApp consent integration: with flag ON, a blocked provider gets the mapped message and the next step is `done`; no DB row created.
- With flag OFF (rollout-safety smoke): the gate is bypassed, current behaviour is preserved end-to-end.

### Local verification commands

```bash
cd field-service
pnpm lint
pnpm exec tsc --noEmit
pnpm test --run __tests__/lib/identity-verification/gate.test.ts \
                __tests__/lib/identity-verification/link.test.ts \
                __tests__/lib/whatsapp-flows/identity-verification.test.ts
pnpm test --run  # full suite — must remain green
```

### Manual end-to-end smoke (after deploy + flag flip)

1. Find a test provider with no PASSED row. WhatsApp them through the consent flow once → first row created (status NOT_STARTED → STARTED → CONSENTED → AWAITING_*). Confirm DB row count = 1.
2. WhatsApp consent flow a second time before the first row terminates → expect "You already have a verification in progress." No new row.
3. Ops marks the first row FAILED. WhatsApp consent flow again → expect new row created (under cap). Repeat until 3 FAILED rows exist.
4. WhatsApp consent flow a 4th time → expect "You've used all 3 verification attempts… please contact support." No new row.
5. PWA equivalent: load `/provider/verify/<token>` for a locked provider → expect the same friendly block message rather than the verification page.

### CI pipeline

Standard `field-service CI` workflow — same as the last two pushes.

### Rollback

If the gate misfires in production:
- Flip `provider.identity.verification.fail_safe` to OFF via the `admin.crud.feature_flags` page (or DB) — instant.
- The migration is additive (one nullable-default column + one index); rollback would require a separate `DROP COLUMN` migration, not strictly needed if the flag is off.

For Lovemore's cleanup, rollback isn't possible — the rows are hard-deleted. The AuditLog row captures the ids and timestamps. If recovery is needed later, manual re-creation from the AuditLog `before` payload is the path.

## Order of operations on the day

1. Land schema migration + flag (default OFF) — ship to main, CI green
2. Land gate function + wiring + tests — ship to main, CI green
3. Run cleanup script for Lovemore — dry run, review, then `--confirm`
4. Flip `provider.identity.verification.fail_safe` flag ON in production
5. Manual smoke per the section above
6. If smoke passes: done. If smoke fails: flip flag OFF, investigate, fix forward.

## Out of scope

- **Admin override on lock** — explicit decision; ticket-only
- **Auto-expiry of stuck non-terminal records** — separate cron concern; deferred. (Today Lovemore's 2 AWAITING_DOCUMENT rows would sit forever without manual cleanup.)
- **Per-provider attempt-budget override** — admin-side "give this provider extra attempts" is a future feature. For v1 the cap is global = 3.
- **Multi-channel concurrent locks** — the gate uses a SELECT, not a row-lock. Two simultaneous create requests from the same provider could both pass the gate. Mitigation: a partial unique index on `(providerId)` where `status` is non-terminal — but that's a follow-up if we see it in practice. For now the existing per-row uniqueness + the rarity of true concurrent creates from the same provider make this acceptable.
- **Migration of historic PASSED providers** — they keep their PASSED row; the gate's first check shields them from accidental re-verification.
- **Notification on lock** — provider only sees the message when they try to start a new verification. No proactive "you've been locked" push notification. Future enhancement if support wants it.
