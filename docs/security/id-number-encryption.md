# ProviderApplication.idNumber Encryption Runbook (SEC-01 / P0-7)

`ProviderApplication.idNumber` holds SA government ID numbers — POPIA §26 special
personal info. This runbook takes it from plaintext-at-rest to AES-256-GCM
encrypted-at-rest with **zero data loss**: every step is additive, verified, and
manually gated.

## Components

| Piece | Path |
|---|---|
| Crypto helper (server-only) | `field-service/lib/pii-crypto.ts` |
| Pure presence/last4 helpers | `field-service/lib/pii-id-number.ts` |
| Dual-write site (only idNumber write path) | `field-service/lib/provider-applications-submit.ts` |
| Full-value read accessor | `getApplicationIdNumber()` in `lib/pii-crypto.ts` |
| Additive migration | `field-service/prisma/migrations/20260706140000_id_number_encryption/` |
| Backfill script (dry-run default) | `field-service/scripts/backfill-id-number-encryption.ts` |
| Retirement script (dry-run default) | `field-service/scripts/retire-plaintext-id-numbers.ts` |

Ciphertext format: `v1:<iv b64>:<authTag b64>:<ciphertext b64>` (versioned for
future key rotation). `idNumberLast4` is stored alongside for admin
display/search without decryption.

## Env var

- **Name:** `PII_ENC_KEY`
- **Format:** 32-byte key, base64 (preferred) or raw 32-char utf8.
- Dedicated to PII column encryption — deliberately separate from
  `IDENTITY_ENC_KEY` (identity-verification vendor payloads) so the two rotate
  independently.

Generate:

```bash
openssl rand -base64 32
```

Set on Vercel (per the printf rule — never `echo`, trailing `\n` corrupts secrets):

```bash
printf '%s' '<generated key>' | vercel env add PII_ENC_KEY production
```

Store the key in the team password manager before setting it — losing the key
after plaintext retirement means losing the ID numbers.

## Degrade-safe behaviour (why deploy order can't corrupt anything)

- **Key absent:** writes proceed exactly as before (plaintext + last4 only);
  a single process-level warning is logged. Reads fall back to plaintext.
- **Key present:** every new submission dual-writes plaintext + ciphertext + last4.
- **Reads:** `getApplicationIdNumber()` prefers decrypting ciphertext, falls back
  to plaintext on any failure. Presence checks (`hasApplicationIdNumber()`) look
  at plaintext OR ciphertext OR last4 so admin UX survives retirement.

## Rollout sequence

1. **Deploy** this PR (migration adds nullable `idNumberCiphertext` +
   `idNumberLast4`; no data touched). Safe with or without the key.
2. **Set `PII_ENC_KEY`** in production (see above) and redeploy/restart so the
   env var is live. New submissions now dual-write.
3. **Backfill** existing rows (encrypts, round-trip verifies, never touches plaintext):
   ```bash
   pnpm tsx scripts/backfill-id-number-encryption.ts             # dry-run first
   pnpm tsx scripts/backfill-id-number-encryption.ts --execute
   ```
4. **Verify** — the retirement script's dry-run is the verification report:
   ```bash
   pnpm tsx scripts/retire-plaintext-id-numbers.ts               # must show 0 failures
   ```
5. **Retire plaintext** (manual, deliberate — only after step 4 is clean and a
   DB backup/snapshot exists):
   ```bash
   pnpm tsx scripts/retire-plaintext-id-numbers.ts --execute
   ```
   The script refuses to null ANYTHING if even one row fails round-trip
   verification.
6. **Schema cleanup (later PR):** only after retirement has been verified in
   prod for a comfortable window, a follow-up migration may drop the plaintext
   column. Never in this PR (house rule: no schema drops in feature PRs).

## Rollback notes

- Steps 1–4 are fully reversible: the new columns are additive and plaintext is
  untouched. Unset `PII_ENC_KEY` to return to pre-change write behaviour.
- After step 5, plaintext is gone from retired rows by design; the data lives in
  `idNumberCiphertext` and requires `PII_ENC_KEY` to read. Rollback = keep the
  key available; there is no path back to plaintext except decrypt-and-rewrite.
- Key loss after step 5 is unrecoverable data loss for the full ID numbers
  (last4 survives). Hence: password-manager backup BEFORE step 2.

## Known residual plaintext locations (out of scope here, tracked)

- `ProviderApplicationDraft.submitPayload` (JSON) — the quality-gate v2 replay
  bundle serializes `idNumber` at WhatsApp summary-confirm time.
- `Conversation.data` (JSON) — carries `idNumber`/`providerIdNumber` while a
  registration flow is in progress.

Both are transient-flow JSON blobs, not long-lived columns; encrypting inside
them changes the replay/flow contracts and needs its own design.
