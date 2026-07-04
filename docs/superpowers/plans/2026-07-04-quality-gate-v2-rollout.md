# Provider Onboarding Quality Gate v2 — Rollout Runbook

## Summary

This runbook captures the exact sequence for rolling out the provider onboarding quality-gate-v2 feature to production. The feature enforces a create-on-PASS Didit KYC gate at application submit, requiring ≥3 work photos and high-risk certification, across WhatsApp registration and both PWA surfaces (`/provider/register`, `/provider/signup`). All behavior is behind feature flag `provider.onboarding.quality_gate_v2` (default OFF). Feature branch: `feat/provider-quality-gate-v2`.

---

## Preconditions & What Was Built

### Feature scope
- **KYC vendor:** Didit (identity verification, no manual fallback)
- **Quality gates:** ≥3 work photos + high-risk certification (if applicable to skill set)
- **Create-on-PASS:** Applications are created only after Didit returns PASSED; mid-Didit abandonment creates no data
- **Channels:** WhatsApp registration + Web PWA resume (`/provider/signup`) + Web PWA self-serve (`/provider/register`)
- **Operator-driven rollout:** Flag flips and vendor config are NOT automated; they require explicit human sign-off

### What exists in the build
- Draft-anchored issuer for KYC links (`ProviderApplicationDraft` with `providerApplicationDraftId` FK)
- Webhook completion module for Didit PASS/FAIL callbacks
- `[quality-gate]` ops notes for FAILED×2 outcomes (do not leak to provider-facing messages)
- Existing identity-verification in-flight re-nudge cron (covers abandoned mid-Didit applicants)
- Feature flag infrastructure (`provider.onboarding.quality_gate_v2`, default OFF)
- Preservation of current behavior when flag is OFF

---

## Database Migrations to Apply to Prod

Apply these migrations **in order** to production **before** flipping any flag. Verify they applied cleanly.

1. **`20260704000000_qgv2_draft_verification_link`**
   - Adds `providerApplicationDraftId` FK to `provider_identity_verifications`
   - Links draft submissions to their KYC verification state

2. **`20260704010000_qgv2_draft_submit_payload`**
   - Adds `submitPayload JSONB` to `provider_application_drafts`
   - Stores the payload at summary time (pre-submit) for replay on Didit PASS

**Note:** These migrations were hand-authored (dev DB not available in build environment). Apply via your standard prod migration path (Vercel Postgres, Prisma migrate, or direct SQL). Confirm success before proceeding.

---

## Rollout Sequence

### Phase 1: Dark Merge & DB Setup

**Step 1:** Merge `feat/provider-quality-gate-v2` to `main` with `provider.onboarding.quality_gate_v2` flag **OFF** (default).
- This makes the code available but inactive.
- All gates are bypassed when the flag is OFF.

**Step 2:** Apply the two migrations listed above to production.
- Verify no errors and that schema is updated.

### Phase 2: Vendor Configuration

**Step 3:** Verify Vercel prod environment secrets are present:
```
DIDIT_API_KEY
DIDIT_WEBHOOK_SECRET
Didit workflow IDs (KYC_AUTHORITATIVE)
```
- If any is missing, **STOP** and provision it before proceeding.

**Step 4:** Activate the Didit vendor via database:
- Turn ON flag: `provider.identity.verification.automation`
- Insert one active `VerificationVendorConfig` row for vendor `didit` (set `active=true`, `enabled=true`)
- Turn ON flag: `provider.identity.vendor.didit`

**Step 5:** Activate KYC-required-for-activation (defense-in-depth):
- Turn ON flag: `provider.kyc.required_for_activation`
- This prevents legacy-path applications from being APPROVED without passing verification, even if quality-gate-v2 is OFF

### Phase 3: End-to-End Verification

**Step 6:** E2E test with the internal `isTestUser` provider cohort:
1. Submit a test application on each channel:
   - WhatsApp registration flow
   - Web PWA resume (`/provider/signup`)
   - Web PWA self-serve (`/provider/register`)
2. For each submission:
   - Verify Didit webhook triggers and returns PASSED
   - Confirm a PENDING `ProviderApplication` is created from the draft (not before Didit completes)
3. Test failure path:
   - Intentionally trigger a Didit FAILED outcome (e.g., KYC verification fails twice)
   - Confirm application lands in MORE_INFO_REQUIRED with `[quality-gate]` ops note
   - **Verify the ops note does NOT leak to the provider-facing rejection message**

**Blockers:** If any of the above fails, roll back by flipping the vendor flags OFF and investigate before retrying.

### Phase 4: Live Activation

**Step 7:** Flip the main feature flag ON:
- Turn ON flag: `provider.onboarding.quality_gate_v2`
- All new applications now flow through the quality gate

### Phase 5: Monitoring

**Step 8:** Monitor first-day funnel:
- Use the existing funnel report (`/admin/reports/funnel`) to track registration → submit → Didit → PASSED conversion
- Watch the identity-verification in-flight re-nudge cron for abandoned mid-Didit applicants
- Set up alerts for Didit webhook failures or high failure rates

---

## Known Follow-ups & Deferred Items

### Draft-race durable fix (DEFERRED — apply at next maintenance window)
The WhatsApp/PWA draft de-duplication at summary time uses a find-then-write pattern, creating a tiny race window if the same phone confirms twice within milliseconds.

**Durable fix:** Add a partial unique index:
```sql
CREATE UNIQUE INDEX idx_provider_application_drafts_phone_unsubmitted 
ON provider_application_drafts (phone) 
WHERE submitted_application_id IS NULL
```

**Pre-requisite:** This index will fail if duplicate unsubmitted drafts exist. Before applying:
1. Identify duplicates: `SELECT phone, COUNT(*) FROM provider_application_drafts WHERE submitted_application_id IS NULL GROUP BY phone HAVING COUNT(*) > 1`
2. Deduplicate (keep oldest, archive or delete newer): `DELETE FROM provider_application_drafts WHERE id IN (...)`
3. Apply the index

**Timing:** Apply this as a follow-up migration after confirming no duplicates exist in prod.

### `hourlyRate` field in self-serve (`/provider/register`) submitPayload
The PWA self-serve wizard does not currently carry `hourlyRate` in the submitPayload, so it replays as `null` when creating the provider record on Didit PASS.

**Action:** Confirm with product whether the self-serve wizard should:
- Capture hourly rate as a form field, OR
- Accept `null` (default to a fallback rate later)

### Rollback
If the feature needs to be disabled:
1. Flip `provider.onboarding.quality_gate_v2` OFF
2. No migration rollback needed (all columns are additive and nullable)
3. Legacy paths are unchanged and fully preserved

---

## Flag Flips & Operator Actions

**Important:** Flag flips and vendor config changes are **operator actions**, not automated by feature code.

### Via CLI
```bash
cd field-service
pnpm run seed-flags -- --flag=provider.onboarding.quality_gate_v2 --enable
pnpm run seed-flags -- --flag=provider.identity.verification.automation --enable
pnpm run seed-flags -- --flag=provider.identity.vendor.didit --enable
pnpm run seed-flags -- --flag=provider.kyc.required_for_activation --enable
```

### Via Database
```sql
UPDATE feature_flags SET enabled = true WHERE key = 'provider.onboarding.quality_gate_v2';
```

### Approval boundaries
Steps 3–6 fall under production config + KYC enforcement and require **explicit user confirmation** before execution. These are not automated:
- Vercel secret provisioning
- Vendor config insertion
- Test execution
- Main flag flip

---

## Checkpoints & Sign-off

Use this checklist to verify each phase is complete before moving to the next:

- [ ] Code merged to `main` (flag OFF by default)
- [ ] Both migrations applied & verified in prod
- [ ] Vercel prod env secrets confirmed present
- [ ] Didit vendor config inserted (VerificationVendorConfig row)
- [ ] `provider.identity.verification.automation` flag ON
- [ ] `provider.identity.vendor.didit` flag ON
- [ ] `provider.kyc.required_for_activation` flag ON
- [ ] E2E test: WhatsApp PASSED path ✓
- [ ] E2E test: Web PWA resume PASSED path ✓
- [ ] E2E test: Web PWA self-serve PASSED path ✓
- [ ] E2E test: FAILED×2 → MORE_INFO_REQUIRED with ops note (NOT exposed) ✓
- [ ] `provider.onboarding.quality_gate_v2` flag ON
- [ ] First-day funnel monitoring active
- [ ] Alerts configured for Didit webhook failures

---

## References

- Feature branch: `feat/provider-quality-gate-v2`
- Spec document: `/docs/superpowers/specs/...` (if applicable)
- Didit integration: `field-service/lib/provider-identity-verification.ts`
- Webhook handler: `field-service/app/api/webhooks/didit/route.ts` (if present)
- Funnel report: `/admin/reports/funnel`
- Re-nudge cron: `field-service/lib/cron/identity-verification-in-flight-re-nudge.ts` (if present)
