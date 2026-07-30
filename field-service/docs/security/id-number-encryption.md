# Runbook — Encrypt `ProviderApplication.idNumber` at rest (SEC-01, POPIA §26)

**Status:** ready to execute. Ships with PR #176 (`feat/audit-p0-idnumber-encryption`).
**Risk:** medium. Steps 1–4 are reversible; **step 5 (retire) permanently nulls plaintext** and is gated on verification.
**Owner:** must be run by someone with prod Vercel env access, prod DB access, and the ability to hold a secret.

---

## What this does & why

SA ID numbers were stored **plaintext** in `provider_applications.idNumber`, past the schema's own "encrypt before GA" TODO — a POPIA §26 special-personal-information exposure. PR #176 adds AES-256-GCM encryption via `lib/pii-crypto.ts`, keyed by a dedicated env var **`PII_ENC_KEY`**, using a **dual-write bridge** so no data is ever lost:

- Additive columns only — `idNumberCiphertext`, `idNumberLast4` — alongside the untouched plaintext column (migration `20260706140000_id_number_encryption`).
- **Degrade-safe:** with `PII_ENC_KEY` absent, behaviour is byte-identical to today (plaintext path, one warning log). Deploy order cannot corrupt data.
- New submissions dual-write (plaintext + ciphertext) at `submitProviderApplication` (the sole `providerApplication.create` that persists idNumber).
- Reads prefer ciphertext, fall back to plaintext.

Going live is a 6-step sequence: **set key → merge → verify migration → backfill existing rows → verify → retire plaintext.**

---

## ⚠️ Read before you start

1. **Losing `PII_ENC_KEY` = permanent, unrecoverable loss of every encrypted ID number** once step 5 (retire) has run. Store it in the team password manager the moment you generate it, before doing anything else.
2. **Never `echo` the key into Vercel** — a trailing newline corrupts the value and every decrypt then fails. Use `printf '%s'` (see step 2).
3. The two scripts **default to dry-run** and **refuse to run without `PII_ENC_KEY`**. `retire` additionally **refuses to write anything at all if a single row fails verification**. Trust these guards — always dry-run first.
4. Do not skip step 4's verify. Retiring plaintext before every row is confirmed-encrypted is the only way to lose data here, and the script is built to stop you — don't override it.

---

## Pre-flight checklist

- [ ] You can set Production env vars in Vercel for the `plug-a-pro` project.
- [ ] You have a working **prod** `DATABASE_URL` in a local shell (pooled is fine — the scripts do reads + row updates, not migrations).
- [ ] The GitHub Actions **`migrate-deploy.yml`** workflow has its `DATABASE_URL` / `DIRECT_URL` secrets configured (it runs `prisma migrate deploy` on merge). If unsure, confirm before step 3 — if it's not wired, the additive-columns migration won't apply automatically and dual-write will error on missing columns.
- [ ] A password manager entry is ready to receive `PII_ENC_KEY`.

---

## Step 1 — Generate the key

```bash
openssl rand -base64 32          # 32 random bytes, base64-encoded (44 chars)
```

`lib/pii-crypto.ts` accepts a 32-byte key as base64 **or** utf8. The `openssl` output above is the recommended form.

- [ ] **Immediately** paste the value into the team password manager (label: `PII_ENC_KEY — Plug A Pro prod`).

## Step 2 — Set the key in Vercel (BEFORE merge)

Setting the key first means the instant PR #176 deploys, dual-write is active — no window where new submissions write plaintext-only.

```bash
# From a shell — NOTE: printf, never echo (echo appends \n and corrupts the key)
printf '%s' 'PASTE_KEY_HERE' | vercel env add PII_ENC_KEY production
# Optional, only if you want to exercise it on preview deploys too:
printf '%s' 'PASTE_KEY_HERE' | vercel env add PII_ENC_KEY preview
```

- [ ] Confirm: `vercel env ls | grep PII_ENC_KEY` shows it in Production.
- [ ] Also add `PII_ENC_KEY` to your **local** `.env` (same value) — the backfill/retire scripts need it in step 3–5.

> The key is dormant until #176's code deploys (main doesn't yet import `pii-crypto`). Setting it early is safe.

## Step 3 — Merge PR #176 and verify the migration applied

1. Merge **PR #176** → `main`.
2. This triggers two things — **verify both before proceeding**:
   - [ ] **GitHub Actions `migrate deploy`** run for the merge commit is **green** (it applies `20260706140000_id_number_encryption`). The Vercel build is gated on this succeeding, so a red run = no deploy.
   - [ ] The Vercel **Production** deploy for the merge commit is **READY**.
3. Confirm the columns exist in prod (either via `prisma migrate status` against prod, or a quick check):
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'provider_applications'
     AND column_name IN ('idNumberCiphertext', 'idNumberLast4');
   -- expect both rows
   ```

At this point **new** provider submissions are already being encrypted (dual-write). Existing rows are still plaintext-only — that's step 4.

## Step 4 — Backfill existing rows

Run from `field-service/`, with `PII_ENC_KEY` and prod `DATABASE_URL` in the environment.

```bash
# Dry-run first — writes NOTHING, prints the queue state
pnpm tsx scripts/backfill-id-number-encryption.ts
#   total rows / needs encryption / already encrypted / no plaintext

# Review the counts, then execute (round-trip verifies every ciphertext before writing)
pnpm tsx scripts/backfill-id-number-encryption.ts --execute
#   done: encrypted=<n> failed_verification=<should be 0>
```

- [ ] Dry-run counts look sane (`needs encryption` ≈ number of applications with an ID on file).
- [ ] `--execute` reports `failed_verification=0`. Any failures = those rows are **skipped, nothing written** — investigate before continuing.
- [ ] The **plaintext column is never modified by this script** — it only fills the ciphertext/last4 columns.

## Step 4b — Verify the queue is drained

```bash
pnpm tsx scripts/backfill-id-number-encryption.ts        # dry-run again
#   needs encryption: 0   ← required before step 5
```

- [ ] `needs encryption: 0`.

## Step 5 — Retire the plaintext (irreversible)

Only after step 4b shows a fully-encrypted queue.

```bash
# Dry-run — verifies decrypt(ciphertext) === plaintext for every row, writes NOTHING
pnpm tsx scripts/retire-plaintext-id-numbers.ts
#   All rows verified. Pass --execute to null the plaintext column on verified rows.

# Execute — nulls plaintext ONLY on verified rows; refuses ALL if any row fails
pnpm tsx scripts/retire-plaintext-id-numbers.ts --execute
#   done: plaintext nulled on <n> rows (expected <n>).
```

- [ ] Dry-run reports **zero verification failures**. If not, it refuses to retire anything — re-run step 4 `--execute` and retry. Do **not** force it.
- [ ] `--execute` "nulled" count matches "expected".

## Step 6 — Post-checks

- [ ] Admin verification/application surfaces still render — they show ID **presence + last4**, decrypting on demand; nothing an admin could previously see is gone.
- [ ] Spot-check one recently-submitted application: `idNumber` (plaintext) is now `NULL`, `idNumberCiphertext` is populated (`v1:...`), `idNumberLast4` shows the right 4 digits.
- [ ] Submit one test provider application end-to-end and confirm it dual-writes (ciphertext present, and after retirement plaintext stays null).

---

## Rollback

- **Before step 5:** fully reversible. Unset `PII_ENC_KEY` in Vercel and redeploy → writes revert to the plaintext path (plaintext column still holds everything). The ciphertext columns remain but are harmless.
- **After step 5:** plaintext is gone; **ciphertext keyed by `PII_ENC_KEY` is now the only copy.** "Rollback" means restoring plaintext from a DB backup taken before step 5 — so **take a DB snapshot before running step 5** if you want that option.

## Known residual plaintext (tracked follow-up, out of scope for this runbook)

ID numbers can still appear plaintext in the draft `submitPayload` JSON and `Conversation.data` replay blobs. Encrypting those would break the PR #163 submitPayload replay contract, so they are a separate, documented follow-up — not addressed here.
