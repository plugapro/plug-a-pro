# West Rand Pilot Flyer — 200 Voucher Codes (xlsx)

**Date:** 2026-05-26
**Status:** Approved, executing

## Problem

200 paper flyers for the West Rand provider pilot have been printed. Each flyer needs a single-use voucher code stapled to it. The codes must:

- Be **valid in production** — i.e. inserted into `voucher_batches` + `promo_vouchers` with the correct campaign, credit amount and expiry
- Be **printable from xlsx** — so they can be cut out and physically stapled
- Match **existing voucher infrastructure** (`PAP-XXXX-XXXX` format, hashed-at-rest, single-use, campaign-scoped duplicate-redemption gate)

## Parameters (user-confirmed)

| Field | Value |
|---|---|
| Count | 200 |
| Campaign code | `WEST_RAND_PILOT_MAY2026` (verified free; only `PILOT_MAY2026` exists) |
| Batch name | `West Rand Pilot Flyer — May 2026` |
| Credit per code | 1 |
| Expiry | 60 days (2026-07-25) |
| Created by | `cmotzf46t0002fk3otj3xrbmp` (Lebogang, OWNER) |
| Database | Production (Supabase aws-1, from `.env.local`) |
| Output | `vouchers-west-rand-may2026.xlsx` |
| xlsx columns | `#`, `Code`, `Expires` (header row frozen, autofilter on, mono code column) |

## Implementation

### 1. Extend the existing generator (back-compatible)

`field-service/scripts/generate-vouchers.ts` gains:

- New flag: `--format csv|xlsx` (default `csv` — existing callers unaffected)
- New branch: when `--format xlsx`, write a workbook using `exceljs` with the columns above
- Same DB transaction and same code/hash invariants — no changes to the security model

### 2. Add dev dependency

`pnpm add -D exceljs` inside `field-service/`. Build-time only; no runtime impact.

### 3. Run against production

The script call documented in the design (see chat). DB writes:

- 1 new `voucher_batches` row
- 200 new `promo_vouchers` rows (status `ACTIVE`, hashes only)
- No mutations or deletions

### 4. Hand off the xlsx

Write the file inside `field-service/` (covered by `field-service/.gitignore`'s `vouchers*.xlsx` rule and the repo-root `**/vouchers*.xlsx` belt-and-braces rule). Surface to the user via `SendUserFile`, and remind them to delete the file after printing — raw codes are irrecoverable from the DB.

### 5. File-before-DB ordering invariant

The script writes the output file **before** the DB transaction commits. If the file write fails, no DB rows are created. If the DB transaction fails after the file is written, the file is deleted so the operator never has plaintext codes whose hashes don't exist in the DB.

## Non-goals

- No new print layout work (user picked the simple-list option; a richer ticket layout was offered and declined)
- No UI changes to `/admin/vouchers`
- No changes to redemption flow, credit ledger, or campaign-dedup logic

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Mistyped `--admin-id` → batch attributed to wrong admin | ID looked up live against production before run |
| Campaign code collides with existing batch | Verified empty before run (`PILOT_MAY2026` is the only existing batch) |
| Raw-code xlsx leaks | Output file gitignored; user reminded to delete after printing |
| Partial insert on transaction failure | Single `$transaction` — all-or-nothing; safe to re-run on failure |

## Rollback

If the batch is wrong, cancel it: each voucher can be moved `ACTIVE → CANCELLED` via `cancelVoucherAction` from the admin panel. A bulk cancel by `batchId` is a follow-up if needed (not in scope here).
