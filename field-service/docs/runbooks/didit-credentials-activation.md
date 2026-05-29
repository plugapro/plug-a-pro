# Claude Code Task — Add Didit credentials to Vercel

**Audience:** A Claude Code session executing on this repo, with the human pasting the Didit secret values into the chat at the right step.

**Scope:** This document covers **only** the Vercel environment-variable setup for the Didit identity-verification adapter. It does **NOT** flip feature flags, activate the vendor config row, or seed the pilot allowlist. Those are deliberately separate phases — see [Out of scope](#out-of-scope) for the next document to run.

**Why this is its own phase:** Without `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, and at least one workflow id, the adapter's `getDiditConfig()` loader returns `{ enabled: false }` and the orchestrator silently falls back to the manual-review path. Flipping any Didit flag before this phase is complete will produce hard `DiditConfigError` failures for every pilot provider that tries to consent.

---

## Pre-conditions

Before starting, confirm in the chat with the human operator:

- [ ] The four secret values are available (Didit Console → `Settings → API Keys` and `Settings → Workflows`).
- [ ] The user knows whether to target **production only** or **production + preview**. Default is **production only** for pilot rollout; preview becomes useful only when QA wants to exercise the hosted flow on a feature branch.
- [ ] `vercel` CLI is installed locally (`vercel --version` returns a number) and logged into the right account (`vercel whoami` returns the operator's username, typically `iamfootprint`).
- [ ] The repo is linked to the right Vercel project. Verify:
  ```bash
  cat field-service/.vercel/project.json | jq '{projectName, projectId, orgId}'
  ```
  Expected:
  ```json
  {
    "projectName": "plug-a-pro",
    "projectId": "prj_xHSXSrkueFjJezsgi8xkR3EpGGya",
    "orgId": "team_AuQBnvSyZpJYcMRWjbXkM7p5"
  }
  ```
  If not linked, run `cd field-service && vercel link --yes --project plug-a-pro`.

If any pre-condition is missing, **stop and report** rather than guessing.

---

## Decisions to confirm with the operator before writing any value

Ask the operator (using `AskUserQuestion` or plain chat) which environments to target. Two reasonable defaults:

| Decision | Production only (recommended for pilot) | Production + Preview |
|---|---|---|
| Where the values land | Vercel production env only | Vercel production env AND preview env |
| Cost exposure | Only real Didit calls in production | Preview branches can also call Didit (each session is billable) |
| Test posture | QA tests against production preview-domain after merge | QA tests against branch preview-URLs before merge |

Default: **production only**. If the operator says "production + preview", duplicate every `vercel env add ... production` invocation with `... preview` below.

---

## The four env vars to add

In the order they should be entered (the API key is the riskiest, do it last so an interruption between vars doesn't leave the adapter half-configured):

| # | Name | Format | Notes |
|---|---|---|---|
| 1 | `DIDIT_PROVIDER_KYC_WORKFLOW_ID` | UUID | The **basic** workflow id (KYC + AML). Used for non-onboarding flows. Optional if only the authoritative workflow exists, but include it if Didit Console shows two workflows. |
| 2 | `DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID` | UUID | The **authoritative** workflow id (KYC + AML + SA DHA). Default for provider onboarding; required because the credit gate and selected-provider acceptance both demand HIGH assurance. |
| 3 | `DIDIT_WEBHOOK_SECRET` | hex/string from Didit destination | Single value, OR comma-separated for rotation (`old,new` — the verifier tries each). Do **not** include the trailing newline that some terminals append on paste. |
| 4 | `DIDIT_API_KEY` | secret string | Sent as the `X-Api-Key` header on every outbound Didit API call. Most sensitive; do this last. |

`DIDIT_BASE_URL` and `DIDIT_SESSION_EXPIRY_HOURS` already have safe defaults in `lib/identity-verification/vendors/didit/config.ts` (`https://verification.didit.me` and `168` respectively). Only add them to Vercel if the operator explicitly wants to override.

---

## Execution steps

For each env var, the operator pastes the value into the chat when prompted, and the Claude Code session pipes it into `vercel env add` via stdin (so the value never goes through shell history or process listings).

### Step 0 — Sanity check the project linkage

```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/Kgolaentle Holdings/Solutions/Projects/Plug A Pro/field-service"
vercel env ls production 2>&1 | grep -E "^DIDIT_" || echo "no DIDIT_ vars in production yet"
```

Expected output: `no DIDIT_ vars in production yet`. If any `DIDIT_*` row already exists, **stop and confirm with the operator** before overwriting — the existing value might be what's actually working.

### Step 1 — `DIDIT_PROVIDER_KYC_WORKFLOW_ID`

Ask the operator: `Paste the BASIC workflow id (UUID from Didit Console → Workflows → KYC Basic).`

When they reply with the value:

```bash
printf '%s' '<PASTED_BASIC_WORKFLOW_ID>' | vercel env add DIDIT_PROVIDER_KYC_WORKFLOW_ID production
```

**Important:** use `printf '%s'` (no trailing newline), and quote the value in single quotes so the shell doesn't expand any `$`. Confirm the command succeeded by checking the return code, then verify:

```bash
vercel env ls production 2>&1 | grep DIDIT_PROVIDER_KYC_WORKFLOW_ID
```

The masked value should appear in the list. If the operator's pasted value contained whitespace or quotes, the `printf` above preserves them exactly — that's correct.

### Step 2 — `DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID`

Same pattern. Ask: `Paste the AUTHORITATIVE workflow id (UUID — the workflow that includes SA DHA validation).`

```bash
printf '%s' '<PASTED_AUTHORITATIVE_WORKFLOW_ID>' | vercel env add DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID production
```

Verify with `vercel env ls production`.

### Step 3 — `DIDIT_WEBHOOK_SECRET`

Ask: `Paste the webhook signing secret from the Didit Console → Destinations → <your destination> → Signing secret. If you're staging a rotation, comma-separate old and new (e.g. "old_secret,new_secret").`

```bash
printf '%s' '<PASTED_WEBHOOK_SECRET>' | vercel env add DIDIT_WEBHOOK_SECRET production
```

Verify. The value is hex on most setups; whitespace will silently break HMAC verification, so the `printf '%s'` (no trailing newline) is critical.

### Step 4 — `DIDIT_API_KEY`

Ask: `Paste the Didit API key (Console → Settings → API Keys → Production). This is the most sensitive value; I will not echo it.`

```bash
printf '%s' '<PASTED_API_KEY>' | vercel env add DIDIT_API_KEY production
```

Verify with `vercel env ls production`. Confirm to the operator: `4/4 Didit vars now in production.`

### Step 5 — Optional preview duplication

If the operator chose **production + preview** in the decision step, repeat Steps 1–4 with `preview` in place of `production`:

```bash
printf '%s' '<value>' | vercel env add DIDIT_PROVIDER_KYC_WORKFLOW_ID preview
printf '%s' '<value>' | vercel env add DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID preview
printf '%s' '<value>' | vercel env add DIDIT_WEBHOOK_SECRET preview
printf '%s' '<value>' | vercel env add DIDIT_API_KEY preview
```

Reuse the same values unless Didit Console gave the operator a separate sandbox key — in which case the operator should explicitly say "preview uses sandbox values" when pasting.

---

## Verification (without triggering Didit calls)

After all four (or eight) `vercel env add` commands succeed:

1. **Listing check** — confirm masked entries appear:
   ```bash
   vercel env ls production 2>&1 | grep -E "^DIDIT_" | sort
   ```
   Expected output (4 lines, masked values):
   ```
   DIDIT_API_KEY                                Encrypted   <age> ago    Production
   DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID Encrypted   <age> ago    Production
   DIDIT_PROVIDER_KYC_WORKFLOW_ID               Encrypted   <age> ago    Production
   DIDIT_WEBHOOK_SECRET                         Encrypted   <age> ago    Production
   ```

2. **Round-trip check** — pull the env to a temp file, confirm shape (NOT values), then wipe:
   ```bash
   vercel env pull --environment=production --yes /tmp/didit-env-check
   grep -cE '^DIDIT_[A-Z_]+=.+$' /tmp/didit-env-check
   # Expected: 4 (or 6 if you added BASE_URL and SESSION_EXPIRY_HOURS too)
   grep -E '^DIDIT_[A-Z_]+=' /tmp/didit-env-check | sed 's/=.*/=<REDACTED>/'
   # Expected: 4 lines of "DIDIT_*=<REDACTED>"
   rm -f /tmp/didit-env-check
   ```
   The `rm -f` is non-negotiable — never leave a `.env*` file with real secrets on disk.

3. **Production deploy refresh** — Vercel does NOT automatically redeploy when env vars change; the next deploy will pick them up, but for now production is still running the build that didn't have them. Two options:
   - **Wait for the next merge to main** — env vars apply on the next natural deploy. Safe, no extra action.
   - **Force a redeploy now** — useful only if the operator wants to flip Didit flags in the same session. Trigger via:
     ```bash
     vercel redeploy <production-deployment-url> --yes
     # Where <production-deployment-url> is the URL from the latest production deployment.
     ```
     Or via the dashboard: Vercel → plug-a-pro → Deployments → latest production → ⋯ → Redeploy → "Use existing Build Cache" off.

   Recommend **wait** unless the operator explicitly asks for an immediate redeploy.

---

## What NOT to do in this session

The following are explicitly **out of scope** for this task instruction. If the operator asks for them, redirect to the next-phase runbook:

- ❌ Flip `provider.identity.vendor.didit` feature flag
- ❌ Flip `provider.identity.verification.automation` feature flag
- ❌ Set `verification_vendor_configs.active = true` for the `didit` row
- ❌ Seed any provider into `ProviderIdentityVerificationPilotAllowlist`
- ❌ Test the end-to-end Didit hosted flow from a real provider device

Doing any of these before a production deploy has picked up the new env vars will produce visible user-facing errors. They belong in `docs/runbooks/didit-rollout-activation.md` (not yet written — create it in the next session if needed).

---

## Rollback

If at any step the operator pastes a wrong value or a partial paste lands:

```bash
# Remove the specific variable, then re-add cleanly.
vercel env rm DIDIT_<NAME> production --yes
printf '%s' '<corrected value>' | vercel env add DIDIT_<NAME> production
```

If the entire setup needs to be reverted:

```bash
for var in DIDIT_API_KEY DIDIT_WEBHOOK_SECRET DIDIT_PROVIDER_KYC_WORKFLOW_ID DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID; do
  vercel env rm "$var" production --yes 2>&1 || true
done
```

This is non-destructive — the adapter just falls back to `{ enabled: false }` and the existing manual/SmileID paths remain untouched.

---

## After completion

1. **Confirm to the operator** verbatim: `Didit credentials are now in Vercel production env. The next production deploy will pick them up. No flags have been flipped — the adapter is still inert until the rollout-activation runbook runs.`

2. **Log to OpenBrain** (`Plug-A-Pro`, domain `engineering`):
   ```bash
   cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend"
   pnpm brain -- knowledge add \
     --project "Plug-A-Pro" \
     --domain "engineering" \
     --title "ops — Didit credentials added to Vercel production (YYYY-MM-DD)" \
     --tags "didit, vercel-env, secrets, rollout, domain:engineering" \
     --content "## What landed
   Four Didit env vars set on Vercel production (target=production only; preview not duplicated unless noted below).

   ## Vars set (values not recorded)
   - DIDIT_PROVIDER_KYC_WORKFLOW_ID
   - DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID
   - DIDIT_WEBHOOK_SECRET
   - DIDIT_API_KEY

   ## Verification
   - vercel env ls production confirms 4 masked entries
   - .env round-trip showed 4 DIDIT_* keys with non-empty values
   - Temp env file wiped

   ## State after this step
   - Adapter still inert until next production deploy picks up the env (or operator force-redeployed; note which)
   - No feature flags flipped
   - No pilot allowlist entries
   - verification_vendor_configs.didit still active=false

   ## Next step
   docs/runbooks/didit-rollout-activation.md (creates next phase: pilot allowlist + flag flips + smoke test)

   ## Risks
   - If a wrong value was pasted, signature verification fails silently on inbound webhooks. Symptom: webhook events stored with signatureValid=false, no state transition. Mitigation: vercel env rm + re-add."
   ```

3. **Do not commit anything to git in this session.** The env-var work is entirely in Vercel; there is no code change.

---

## Reference

- Plan file: `~/.claude/plans/you-are-working-inside-snazzy-scott.md`
- Adapter source: `field-service/lib/identity-verification/vendors/didit/`
- Config loader (the consumer of these env vars): `field-service/lib/identity-verification/vendors/didit/config.ts`
- PR: https://github.com/plugapro/plug-a-pro/pull/24 (merged as `ba890777f`)
- Didit docs:
  - Workflows: https://docs.didit.me/configuration/workflows
  - Webhooks: https://docs.didit.me/integration/webhooks
  - API auth: https://docs.didit.me/api-reference/overview
