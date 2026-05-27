# Identity verification fail-safe — no concurrent submissions, hard 3-attempt cap

**Date:** 2026-05-26 (revised 2026-05-27 after user review)
**Status:** Awaiting user re-review
**Trigger:** Lovemore Sibanda (`b6b91902-…`) has 4 verification rows in production — 1 PASSED, 1 NEEDS_MANUAL_REVIEW, 2 AWAITING_DOCUMENT. He shouldn't have been able to create more than 1.

## Revision history

**2026-05-27 — review-driven corrections:**
1. Gate gains a `purpose: 'GENERAL_IDENTITY' | 'CREDIT_TOP_UP'` parameter — `PROVIDER_ALREADY_VERIFIED` is scoped to the purpose so a WhatsApp-LOW PASSED row doesn't block the PWA-HIGH upgrade required for credit top-ups (`credit-gate.ts:35-46` requires PASSED+PASS+HIGH).
2. `VERIFICATION_IN_PROGRESS` is reframed as **resumable** — the gate returns the existing verification id so the caller can reissue a token (PWA) or pick up the row (WhatsApp), preserving the resume UX that `link.ts:63-83` provides today.
3. Flag-off behaviour is now explicitly the legacy reuse logic, not "no gate at all" — the new code path is wrapped in the flag; when off, today's per-channel reuse-then-create is preserved verbatim.
4. Cleanup FK plan corrected against the actual schema — `security_events.subjectVerificationId` is `Restrict` (`schema.prisma:1945`), `webhook events` + `sensitive access logs` are `SetNull`. Renamed `provider_identity_security_events` → `security_events`.
5. Migration deploy plan now accounts for production drift — local `prisma migrate status` shows 2 disk migrations not in the production migration history (`20260526090000_otp_fraud_response_security` was applied manually via Supabase MCP; `20260526110000_add_voucher_redemption_attempt_analytics` state unknown). Blind `prisma migrate deploy` would either re-run or fail.
6. Smoke test entry points updated — token resolution at `/provider/verify/<token>:155` is read-only and never triggered the gate. Smoke now exercises the **link issuance** entry points: WhatsApp consent-accept handler and the PWA "verify your identity" CTA on `/provider/credits`.
7. Cleanup script now handles **storage blobs** — `provider_identity_documents.blobKey` references Vercel Blob storage; deleting the row alone orphans the blob. Script reads blob keys, deletes blobs first (or records them for purge), then deletes rows.

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

**Cascade rows — handled per their actual FK behaviour in `schema.prisma`:**

| Table | FK behaviour | Script handles by |
|---|---|---|
| `provider_identity_documents` | `Cascade` | Automatic on parent delete. But the script must first **enumerate `blobKey` values and delete the storage blobs** (`@vercel/blob` `del()`) — otherwise Vercel Blob retains orphan files indefinitely. |
| `provider_verification_reviews` | `Cascade` | Automatic on parent delete. No blob refs. |
| `provider_verification_webhook_events` | `SetNull` (verification FK) | Auto-nullified — webhook history retained without the link. |
| `provider_sensitive_data_access_logs` | `SetNull` | Auto-nullified — audit trail retained. |
| `provider_identity_consent_events` | check `schema.prisma:1968` area | The script verifies the FK behaviour at runtime; if `Cascade` use auto, if `Restrict` delete manually before parent. |
| `security_events.subjectVerificationId` | **`Restrict` (`schema.prisma:1945`)** | Blocks the parent delete. The script first looks up any `security_events` rows for each victim verification and either (a) deletes them too — if they have no independent audit value — or (b) aborts with a clear message listing the blocking rows so an operator can resolve manually. Default: **abort + report**, never silently widen the blast radius. |

The script writes a single `AuditLog` row per deleted verification (`actorId` from `--admin-id`, `entityType = 'ProviderIdentityVerification'`, `entityId = <verification id>`, `before` = the full row pre-delete) so the action is recoverable from the log if needed.

**One-off script:** `field-service/scripts/cleanup-provider-identity-verifications.ts`. Required flags:
- `--provider-id <id>` — target provider
- `--admin-id <id>` — admin user attributed in `AuditLog`
- `--keep-status PASSED` — which statuses to retain
- `--confirm` — must be passed to actually delete (otherwise dry-run prints the plan)

Behaviour:
1. Open a transaction.
2. List target verifications + count cascade rows in each affected table.
3. Enumerate `provider_identity_documents.blobKey` values; **delete blobs first** via `@vercel/blob` `del()` (logging successes; on blob delete failure, abort the transaction).
4. Check `security_events` for any rows referencing the target verifications. If any exist and they have audit value (look at `eventType` — security audit events stay; everything else is fine to delete), abort with a clear listing. If none or all are deletable, delete them.
5. Delete the target verification rows (CASCADE handles documents + reviews; SetNull handles webhooks + access logs).
6. Write one `AuditLog` row per deleted verification with `before` capturing the full row JSON.
7. Commit.

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
export type VerificationStartPurpose =
  | 'GENERAL_IDENTITY'   // any PASSED satisfies — provider just wants the green tick
  | 'CREDIT_TOP_UP'      // requires PASSED + PASS + HIGH (matches credit-gate.ts:35-46)

export type VerificationStartCheck =
  // Brand-new attempt allowed — caller proceeds to create
  | { ok: 'CREATE' }
  // Existing non-terminal row found — caller reuses it (reissue token or continue flow).
  // Mirrors today's `existing ?? create` behaviour in link.ts:63-83 but cross-channel.
  | { ok: 'RESUME'; verificationId: string; status: VerificationStatus; channel: VerificationChannel }
  // Hard block — caller surfaces the mapped message and creates nothing.
  | { ok: false; reason: VerificationStartBlockReason; message: string }

export type VerificationStartBlockReason =
  | 'PROVIDER_ALREADY_VERIFIED'  // PASSED row satisfying the requested purpose exists
  | 'VERIFICATION_LOCKED'        // 3+ FAILED post-cutoff for CREDIT_TOP_UP, or 3 for general

export async function checkCanStartNewVerification(
  providerId: string,
  opts: { purpose: VerificationStartPurpose; tx?: PrismaTransactionClient },
): Promise<VerificationStartCheck>
```

The gate runs a small set of indexed queries (in one transaction when `tx` is provided):

1. **In-progress check** (cross-channel, cross-purpose):
   ```sql
   SELECT id, status, channel
   FROM provider_identity_verifications
   WHERE "providerId" = $1
     AND status NOT IN ('PASSED','FAILED','EXPIRED','CANCELLED')
   ORDER BY "updatedAt" DESC
   LIMIT 1
   ```
   If a row is returned → `{ ok: 'RESUME', verificationId, status, channel }`. Resume always wins over any block — the provider should finish what they started.

2. **Already-verified check** (purpose-scoped):
   - `purpose === 'CREDIT_TOP_UP'` uses the same WHERE that `credit-gate.ts` builds: `status='PASSED' AND decision='PASS' AND assuranceLevel='HIGH' AND (expiresAt IS NULL OR expiresAt > now())`.
   - `purpose === 'GENERAL_IDENTITY'` uses `status='PASSED'` only.
   - If a satisfying row exists → `{ ok: false, reason: 'PROVIDER_ALREADY_VERIFIED', message }`.

3. **Attempt cap** — count FAILED rows with `countsTowardAttemptCap = true`. If `>= 3` → `{ ok: false, reason: 'VERIFICATION_LOCKED', message }`.

4. Otherwise → `{ ok: 'CREATE' }`.

The ordering matters: **resume beats block**. A provider with 3 FAILED + 1 in-progress should be allowed to finish the in-progress one (the gate doesn't punish them for trying), but once that one terminates, future creation is then blocked by the cap.

#### Wiring

Both entry points read `provider.identity.verification.fail_safe` first. **When the flag is OFF, today's behaviour is preserved verbatim** — no regression from removing the existing reuse logic.

- `lib/identity-verification/link.ts:63-83`:
  - Flag OFF → existing per-channel reuse-then-create path runs unchanged (preserves PWA resume behaviour today).
  - Flag ON → call `checkCanStartNewVerification(providerId, { purpose: input.purpose ?? 'GENERAL_IDENTITY' })`.
    - `ok: 'CREATE'` → create the row, issue token, same as today's create branch.
    - `ok: 'RESUME'` → skip create, reuse `result.verificationId`, issue a fresh token for it. Identical observable behaviour to today's `existing ?? create` path but cross-channel.
    - `ok: false` → throw `ProviderIdentityVerificationLinkError` with the reason and message. The caller (provider PWA action or admin link issuance) renders the message.
- `lib/whatsapp-flows/identity-verification.ts:85-95`:
  - Flag OFF → unconditional `create` (today's behaviour, including the documented bug — but no regression).
  - Flag ON → call `checkCanStartNewVerification(provider.id, { purpose: 'GENERAL_IDENTITY' })`.
    - `ok: 'CREATE'` → create and proceed through the consent state transitions.
    - `ok: 'RESUME'` → skip create, pick up the existing verification id, run the `STARTED → CONSENTED → AWAITING_*` transitions against it. If the row is already past `CONSENTED`, just continue from its current state without re-emitting the consent transitions.
    - `ok: false` → send mapped WhatsApp message; `nextStep: 'done'`.

The `purpose` value: for the credit top-up CTA on `/provider/credits`, the link issuer passes `'CREDIT_TOP_UP'`. Everywhere else (admin-issued link, general "verify your identity" CTA, WhatsApp consent flow) passes `'GENERAL_IDENTITY'`.

#### User-facing messages

Only two block reasons surface to the user — the `RESUME` case is silent (the caller just reuses the existing row and issues a fresh token; the provider experiences continuity, not an error).

| Block reason | Purpose | WhatsApp / PWA message |
|---|---|---|
| `PROVIDER_ALREADY_VERIFIED` | `GENERAL_IDENTITY` | "Your identity is already verified — no action needed." |
| `PROVIDER_ALREADY_VERIFIED` | `CREDIT_TOP_UP` | (never fires unless the provider somehow has a PASSED+HIGH already, in which case the credit gate at `credit-gate.ts:35` would have let them through and they wouldn't be at the CTA. Defensive message:) "Your identity is already verified at the required level. You can purchase credits now." |
| `VERIFICATION_LOCKED` | both | "You've used all 3 verification attempts. For security reasons we can't accept another submission automatically. Please contact support so we can review your case manually." |

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

Each case asserts the return shape for **both** `purpose: 'GENERAL_IDENTITY'` and `purpose: 'CREDIT_TOP_UP'` where they diverge.

| Provider state | purpose=GENERAL_IDENTITY | purpose=CREDIT_TOP_UP |
|---|---|---|
| 0 records | `{ ok: 'CREATE' }` | `{ ok: 'CREATE' }` |
| 1 PASSED (LOW) — WhatsApp | `PROVIDER_ALREADY_VERIFIED` | `{ ok: 'CREATE' }` ← the key correctness case |
| 1 PASSED + PASS + HIGH, not expired | `PROVIDER_ALREADY_VERIFIED` | `PROVIDER_ALREADY_VERIFIED` |
| 1 PASSED + PASS + HIGH, expired (`expiresAt < now`) | `PROVIDER_ALREADY_VERIFIED`* | `{ ok: 'CREATE' }` |
| 1 NEEDS_MANUAL_REVIEW (PWA) | `{ ok: 'RESUME', channel: 'PWA' }` | `{ ok: 'RESUME' }` (resume wins regardless of purpose) |
| 1 AWAITING_DOCUMENT (WhatsApp) | `{ ok: 'RESUME', channel: 'WHATSAPP' }` | `{ ok: 'RESUME' }` |
| 3 FAILED post-cutoff + nothing else | `VERIFICATION_LOCKED` | `VERIFICATION_LOCKED` |
| 2 FAILED post-cutoff + 0 in-progress | `{ ok: 'CREATE' }` | `{ ok: 'CREATE' }` (under cap) |
| 5 FAILED pre-cutoff (`countsTowardAttemptCap=false`) + 0 post-cutoff | `{ ok: 'CREATE' }` | `{ ok: 'CREATE' }` (historic don't count) |
| 3 FAILED post-cutoff + 1 in-progress | `{ ok: 'RESUME' }` (resume beats lock) | `{ ok: 'RESUME' }` |
| 1 EXPIRED + 0 in-progress + 0 FAILED | `{ ok: 'CREATE' }` | `{ ok: 'CREATE' }` (EXPIRED doesn't count) |
| 1 CANCELLED + 0 in-progress + 0 FAILED | `{ ok: 'CREATE' }` | `{ ok: 'CREATE' }` |
| 1 PASSED (LOW) + 1 NEEDS_MANUAL_REVIEW | `{ ok: 'RESUME' }` | `{ ok: 'RESUME' }` (resume wins) |

*The general-identity check is permissive — `PASSED` at any assurance, even expired, satisfies it. If we want to tighten this later (e.g., re-verify after a year), a separate `expiresAt` clause goes in.

### Integration tests

- `link.ts` integration (flag ON):
  - Provider with WhatsApp PASSED+LOW + purpose=`GENERAL_IDENTITY` → throws `ProviderIdentityVerificationLinkError('PROVIDER_ALREADY_VERIFIED')`, no row created.
  - Same provider + purpose=`CREDIT_TOP_UP` → row created (gate returns CREATE).
  - Provider with non-terminal in any channel + any purpose → returns the **existing** row id and reissues a token; DB row count unchanged.
  - Provider with 3 FAILED post-cutoff → throws `VERIFICATION_LOCKED`.
- WhatsApp consent integration (flag ON):
  - Provider with non-terminal → handler picks up existing row, no new row created; consent transitions are idempotent against the existing state.
  - Provider with 3 FAILED post-cutoff → sends `VERIFICATION_LOCKED` copy, `nextStep: 'done'`, no row created.
  - Provider with WhatsApp PASSED+LOW → sends `PROVIDER_ALREADY_VERIFIED` copy (general purpose), no row created.
- Flag-OFF regression smoke:
  - PWA link path: per-channel reuse + create runs identically to today (compare row counts with snapshot fixtures).
  - WhatsApp consent: unconditional create runs identically to today.
  - This catches accidental coupling of the new code path to the flag-off branch.

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

The smoke must exercise **link-issuance / row-creation** entry points, not token-resolution pages. `/provider/verify/<token>` only resolves an existing row (`app/provider/verify/[token]/page.tsx:155-164`) — it never triggers the gate.

1. **Baseline:** find a test provider with no PASSED row. WhatsApp them through the consent flow once → row created (status NOT_STARTED → STARTED → CONSENTED → AWAITING_*). Confirm DB count = 1.
2. **Resume across channels:** while the WhatsApp row is still in `AWAITING_DOCUMENT`, hit the PWA "Verify your identity" CTA on `/provider/credits` (which calls `linkProviderIdentityVerification`). Expect `ok: 'RESUME'` → a fresh token is issued for the **existing** WhatsApp verification id, and the provider can continue the same flow on the PWA. DB count stays at 1.
3. **Repeat-consent resume in WhatsApp:** while still mid-flow, tap "Verify identity" again in WhatsApp. Expect the handler to pick up the existing row and not create a new one. DB count stays at 1.
4. **Cap accumulation:** ops marks the row FAILED. Provider taps "Verify identity" in WhatsApp again → expect `ok: 'CREATE'`, a new row appears (count = 2, one PASSED-not-yet so cap is `failed=1`). Continue until 3 FAILED rows exist.
5. **Lock fires:** provider taps "Verify identity" a 4th time → expect `VERIFICATION_LOCKED` message ("You've used all 3 verification attempts… please contact support."). DB count remains at 3.
6. **Credit-purpose scope:** provider with a WhatsApp PASSED+LOW row taps the **credit top-up** CTA on `/provider/credits`. Expect `ok: 'CREATE'` (not blocked by PROVIDER_ALREADY_VERIFIED) because the purpose is `CREDIT_TOP_UP` which requires HIGH. Same provider hitting the **general "Verify identity"** CTA expects `PROVIDER_ALREADY_VERIFIED` ("Your identity is already verified — no action needed.").
7. **Flag-off regression check:** flip `provider.identity.verification.fail_safe` OFF for one round. Repeat step 2 → expect today's per-channel behaviour to be preserved (PWA reuse for the existing PWA row, WhatsApp unconditional create — i.e. the documented bug returns, confirming the flag is a true escape hatch).

### CI pipeline

Standard `field-service CI` workflow — same as the last two pushes.

### Rollback

If the gate misfires in production:
- Flip `provider.identity.verification.fail_safe` to OFF via the `admin.crud.feature_flags` page (or DB) — instant.
- The migration is additive (one nullable-default column + one index); rollback would require a separate `DROP COLUMN` migration, not strictly needed if the flag is off.

For Lovemore's cleanup, rollback isn't possible — the rows are hard-deleted. The AuditLog row captures the ids and timestamps. If recovery is needed later, manual re-creation from the AuditLog `before` payload is the path.

## Order of operations on the day

### Migration deploy — production drift warning

Local `prisma migrate status` against production shows the on-disk migration history is **ahead** of production by 2 entries:
- `20260526090000_otp_fraud_response_security` — already applied manually via Supabase MCP earlier this sprint (per the OpenBrain log on the OTP fix). Marked as **out-of-history** in production.
- `20260526110000_add_voucher_redemption_attempt_analytics` — state unknown; likely also applied out-of-history during the voucher-tooling work.

**Do NOT run `prisma migrate deploy` blindly.** It would attempt to re-apply the already-run migrations and either fail with "relation already exists" or, worse, drop and recreate columns that have live data.

The correct sequence for the new fail-safe migration:
1. Run `prisma migrate status` against production. Confirm which migrations are in `_prisma_migrations` table vs on disk.
2. For each on-disk migration not in the production table that has already been applied via raw SQL, run `prisma migrate resolve --applied <name>` to record it as applied without re-running the SQL.
3. Once the production `_prisma_migrations` table matches the on-disk history up to and including all prior changes, *then* `prisma migrate deploy` applies only the new fail-safe migration.
4. Verify the new column + index exist with a direct `\d provider_identity_verifications`.

### Rollout

1. Land schema migration + flag (default OFF) on main — CI green.
2. Apply migration in production using the sequence above. Confirm column exists and is backfilled.
3. Land gate function + wiring + tests on main — CI green.
4. Run cleanup script for Lovemore: first `--dry-run` (no flag), review output, then re-run with `--confirm`.
5. Flip `provider.identity.verification.fail_safe` flag ON in production.
6. Manual smoke per the section above — including the credit-purpose scope test (step 6) and the flag-off regression check (step 7).
7. If smoke passes: done. If smoke fails: flip flag OFF (immediate; preserves today's behaviour), investigate, fix forward.

## Out of scope

- **Admin override on lock** — explicit decision; ticket-only.
- **Auto-expiry of stuck non-terminal records** — separate cron concern; deferred. Lovemore's 2 AWAITING_DOCUMENT rows are handled by the one-off cleanup; long-term solution (auto-expire after N days) is a follow-up.
- **Per-provider attempt-budget override** — admin-side "give this provider extra attempts" is a future feature. For v1 the cap is global = 3.
- **Multi-channel concurrent creates** — the gate uses SELECT, not row-lock. Two truly simultaneous create requests from the same provider could both pass the gate. Mitigation (deferred): a partial unique index on `(providerId)` where `status NOT IN terminal`. Rare in practice given the consent UX rate.
- **Migration of historic PASSED providers** — they keep their PASSED row; the gate's purpose-scoped already-verified check handles them correctly.
- **Notification on lock** — provider only sees the message at next attempt. No proactive push.
- **Generalising `purpose` beyond credit top-ups** — additional purposes (e.g., "high-value job assignment requires HIGH") plug into the same parameter when we need them; v1 only ships `GENERAL_IDENTITY` and `CREDIT_TOP_UP`.
