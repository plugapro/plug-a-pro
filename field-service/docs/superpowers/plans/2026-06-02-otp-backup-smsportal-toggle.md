# OTP Backup SMSPortal Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SMSPortal a reliable backup OTP delivery path that operators can switch to quickly without changing the Supabase OTP generation or verification flow.

**Architecture:** Supabase Auth remains the owner of OTP generation, storage, expiry, and `verifyOtp`. Delivery is selected by the Supabase Auth Send SMS Hook URL: Path A calls the Vercel Next.js WhatsApp hook, and Path B calls the Supabase Edge Function that sends through SMSPortal. The initial implementation is an operator-safe cutover runbook plus small backup-path hardening, not automatic per-request fallback.

**Tech Stack:** Next.js 16 App Router, Supabase Auth Hooks, Supabase Edge Functions, Supabase CLI, SMSPortal REST API, Prisma feature flags, Vitest.

---

## Current Verified State

Verified on 2026-06-02 from `field-service/`:

- `send-sms-otp` is deployed and active: version `17`, updated `2026-04-13 10:46:17 UTC`.
- Supabase secret names exist: `SMSPORTAL_CLIENT_ID`, `SMSPORTAL_CLIENT_SECRET`, and `SEND_SMS_HOOK_SECRET`.
- An unsigned request to `https://oghbryokdizklgwaqksp.supabase.co/functions/v1/send-sms-otp` reached the Deno handler and returned handler-level `Unauthorized`; the function is not currently blocked by Supabase's JWT gateway before handler code runs.
- `supabase --version` reports `2.75.0`; Supabase reports `2.104.0` as available. Use the dashboard for logs/config if the local CLI lacks a command.
- `field-service/app/api/auth/hooks/send-sms/route.ts` returns `503 otp_whatsapp_disabled` when `auth.otp.whatsapp` is off. Turning the flag off before repointing the Send SMS Hook will break OTP delivery.
- `field-service/scripts/seed-flags.ts` supports scoped flag changes. Use `pnpm exec tsx scripts/seed-flags.ts --flag=auth.otp.whatsapp` to disable only that flag.

## Decision

Do this in two layers:

1. **Emergency cutover procedure:** Repoint Supabase Auth Send SMS Hook from the Vercel WhatsApp route to the SMSPortal Edge Function, then disable `auth.otp.whatsapp` defensively. This can be done today without app redeploy.
2. **Hardening work:** Commit the backup function configuration, make the payload parsing tolerate both `sms.phone` and `user.phone`, reduce diagnostic noise, add a readiness runbook, and update README wording so future operators do not misread the feature flag as the channel selector.

Do not build automatic WhatsApp-to-SMS fallback in the first pass. That would keep Supabase pointed at the Next.js route, but the SMS retry would need SMSPortal credentials in Vercel and must preserve rate limiting, OTP challenge tracking, `security.otp.report`, and no-OTP-leak guarantees. That is a separate implementation plan.

## Emergency Cutover Runbook

Use this only with explicit approval because it changes production OTP delivery.

- [ ] **Step 1: Confirm Path B still exists**

Run:

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/Kgolaentle\ Holdings/Solutions/Projects/Plug\ A\ Pro/field-service
supabase functions list
supabase secrets list
```

Expected:

- `send-sms-otp` appears with `STATUS` of `ACTIVE`.
- `SMSPORTAL_CLIENT_ID`, `SMSPORTAL_CLIENT_SECRET`, and `SEND_SMS_HOOK_SECRET` appear by name.
- Do not print or paste secret values.

- [ ] **Step 2: Confirm unauthenticated requests reach the handler**

Run:

```bash
curl -sS -i -X POST 'https://oghbryokdizklgwaqksp.supabase.co/functions/v1/send-sms-otp' \
  -H 'Content-Type: application/json' \
  --data '{"user":{"phone":"+27820000000"},"sms":{"otp":"000000"}}' \
  | sed -n '1,24p'
```

Expected:

```text
HTTP/2 401
...
Unauthorized
```

This proves the request reaches the function handler and fails because the hook signature is missing. If the response says the authorization header or JWT is missing, stop and verify the function's JWT setting before cutover.

- [ ] **Step 3: Repoint Supabase Auth Hook**

In Supabase Dashboard:

```text
Authentication -> Hooks -> Send SMS Hook
```

Set:

```text
URL: https://oghbryokdizklgwaqksp.supabase.co/functions/v1/send-sms-otp
Hook secret: same value stored as SEND_SMS_HOOK_SECRET
```

Save. Do not rotate the secret during emergency cutover unless the secret is suspected compromised.

- [ ] **Step 4: Disable Path A defensively**

Run after the dashboard hook is saved:

```bash
pnpm exec tsx scripts/seed-flags.ts --flag=auth.otp.whatsapp
```

Expected output includes:

```text
disabled auth.otp.whatsapp
Done.
```

Do not run `pnpm exec tsx scripts/seed-flags.ts` without `--flag`; that disables every registered flag.

- [ ] **Step 5: Send one live OTP from phone sign-in**

Use a controlled phone number and start a normal sign-in from the app. Do not use the Edge Function URL directly with the real hook secret because that could bypass the normal Supabase Auth OTP lifecycle.

Expected:

- OTP arrives by SMS.
- The same OTP verifies through the unchanged app `verifyOtp` flow.
- In-flight WhatsApp OTPs sent before cutover continue to verify until expiry.

- [ ] **Step 6: Monitor Path B**

Use Supabase Dashboard Edge Function logs for `send-sms-otp`. If the local CLI has been upgraded and supports function logs, use the CLI equivalent; the currently installed CLI `2.75.0` does not list a `functions logs` command.

Watch for:

- `sent OK phone=...`
- `Unauthorized` from probe traffic only
- `SMSPortal auth failed`
- `SMSPortal send failed`
- `Missing phone or otp in payload`

- [ ] **Step 7: Roll back to Path A**

In Supabase Dashboard, set Send SMS Hook URL back to:

```text
https://app.plugapro.co.za/api/auth/hooks/send-sms
```

Then run:

```bash
pnpm exec tsx scripts/seed-flags.ts --flag=auth.otp.whatsapp --enable
```

Expected output includes:

```text
enabled auth.otp.whatsapp
Done.
```

Send one controlled OTP and confirm WhatsApp delivery resumes.

## Implementation Tasks

### Task 1: Commit Edge Function Configuration

**Files:**
- Create: `field-service/supabase/config.toml`

- [ ] **Step 1: Add per-function JWT configuration**

Create `field-service/supabase/config.toml`:

```toml
[functions.send-sms-otp]
verify_jwt = false
```

Reason: Supabase Auth Hook calls are authenticated by the Standard Webhooks signature and the shared hook secret, not by a user JWT. This documents and pins the runtime behavior that the live function already appears to have.

- [ ] **Step 2: Redeploy only the Edge Function after approval**

Run only after explicit deployment approval:

```bash
supabase functions deploy send-sms-otp
```

Expected:

- CLI completes without changing other functions.
- `supabase functions list` still shows `send-sms-otp` as `ACTIVE`.

- [ ] **Step 3: Probe unauthorized behavior**

Run the Step 2 probe from the emergency runbook.

Expected:

```text
HTTP/2 401
...
Unauthorized
```

### Task 2: Harden `send-sms-otp` Payload Handling

**Files:**
- Modify: `field-service/supabase/functions/send-sms-otp/index.ts`

- [ ] **Step 1: Accept phone from both known hook shapes**

Change the parsed payload type and phone extraction:

```ts
let parsedPayload: {
  user?: { id?: string; phone?: string }
  sms?: { otp?: string; phone?: string }
}

const phone = parsedPayload.sms?.phone ?? parsedPayload.user?.phone
const otp = parsedPayload.sms?.otp
```

Reason: the Next.js Path A route currently reads `sms.phone`, while the Edge Function reads `user.phone`. Path B should tolerate both shapes before it becomes the backup path.

- [ ] **Step 2: Stop returning raw upstream error text to callers**

Replace:

```ts
return json({ error: String(err) }, 500)
```

with:

```ts
return json({ error: 'SMSPortal delivery failed' }, 500)
```

Keep detailed errors in function logs only.

- [ ] **Step 3: Keep logs OTP-safe**

Search the function for direct `otp` logging:

```bash
rg -n "otp|parsedPayload|payload|SMSPortal" supabase/functions/send-sms-otp/index.ts
```

Expected:

- No log line prints the OTP value.
- No log line prints `SEND_SMS_HOOK_SECRET` or bearer tokens.
- Phone logs remain masked.

### Task 3: Add Backup Cutover Documentation

**Files:**
- Create: `field-service/docs/runbooks/otp-smsportal-cutover.md`
- Modify: `field-service/README.md`

- [ ] **Step 1: Create the runbook**

Create `field-service/docs/runbooks/otp-smsportal-cutover.md` with these sections:

```markdown
# OTP SMSPortal Backup Cutover Runbook

## When to Use

Use this when WhatsApp OTP delivery is failing and production sign-in must move to SMSPortal.

## Current Channel Selector

Supabase Auth chooses the delivery hook. The app does not switch between WhatsApp and SMSPortal at request time.

## Cutover

1. Confirm `send-sms-otp` is active with `supabase functions list`.
2. Confirm `SMSPORTAL_CLIENT_ID`, `SMSPORTAL_CLIENT_SECRET`, and `SEND_SMS_HOOK_SECRET` are present with `supabase secrets list`.
3. Set Supabase Dashboard `Authentication -> Hooks -> Send SMS Hook` URL to `https://oghbryokdizklgwaqksp.supabase.co/functions/v1/send-sms-otp`.
4. Keep the hook secret equal to `SEND_SMS_HOOK_SECRET`.
5. Run `pnpm exec tsx scripts/seed-flags.ts --flag=auth.otp.whatsapp`.
6. Send and verify one controlled OTP.

## Rollback

1. Set the Send SMS Hook URL back to the Vercel route.
2. Run `pnpm exec tsx scripts/seed-flags.ts --flag=auth.otp.whatsapp --enable`.
3. Send and verify one controlled OTP.

## Caveats

- In-flight OTPs from either channel verify until expiry.
- SMSPortal logs are in Supabase Edge Function logs, not Vercel.
- SMSPortal path is backup delivery only; Path A owns rate limiting, challenge tracking, and `security.otp.report`.
```

- [ ] **Step 2: Update README OTP section**

Change the note in `field-service/README.md` so it says:

```markdown
The channel selector is the Supabase Send SMS Hook URL. `auth.otp.whatsapp` is not a fallback switch; when the hook still points at `/api/auth/hooks/send-sms`, disabling the flag makes that route return `503 otp_whatsapp_disabled`. For SMSPortal backup cutover, repoint the hook first, then disable the flag defensively.
```

### Task 4: Verify

**Files:**
- Test: `field-service/__tests__/api/auth/hooks/send-sms.test.ts`
- Test: `field-service/__tests__/api/auth/hooks/send-sms-security-gate.test.ts`
- Test: `field-service/__tests__/api/auth/hooks/send-sms-security-check.test.ts`
- Test: `field-service/__tests__/lib/otp-delivery.test.ts`

- [ ] **Step 1: Run focused tests for Path A unchanged behavior**

Run:

```bash
pnpm exec vitest run \
  __tests__/api/auth/hooks/send-sms.test.ts \
  __tests__/api/auth/hooks/send-sms-security-gate.test.ts \
  __tests__/api/auth/hooks/send-sms-security-check.test.ts \
  __tests__/lib/otp-delivery.test.ts
```

Expected:

- All tests pass.
- Existing assertions still confirm the WhatsApp route returns `503 otp_whatsapp_disabled` when the feature flag is off.
- Existing assertions still confirm OTP values are not leaked to Path A logs.

- [ ] **Step 2: Run project checks**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected:

- `pnpm typecheck` exits `0`.
- `pnpm lint` exits `0`.

- [ ] **Step 3: Re-run non-mutating Supabase readiness checks**

Run:

```bash
supabase functions list
supabase secrets list
curl -sS -i -X POST 'https://oghbryokdizklgwaqksp.supabase.co/functions/v1/send-sms-otp' \
  -H 'Content-Type: application/json' \
  --data '{"user":{"phone":"+27820000000"},"sms":{"otp":"000000"}}' \
  | sed -n '1,24p'
```

Expected:

- Function is active.
- Required secret names are present.
- Probe returns handler-level `Unauthorized`.

## Follow-Up Plan for True Automatic Fallback

If the target changes from "easy cutover" to "try WhatsApp first, then SMSPortal in the same request", create a separate plan that:

- Adds a server-side SMSPortal delivery adapter in the Next.js app.
- Adds Vercel env vars for SMSPortal credentials.
- Retries only `WA_AUTH_FAILED`, `WA_TRANSIENT`, and `TEMPLATE_NOT_APPROVED` failures.
- Writes `otp_delivery_attempts` rows for both channels.
- Preserves `checkOtpSendLimit`, `recordOtpChallenge`, `security.otp.report`, and no-OTP-leak tests.
- Defines whether SMS fallback should return `200` to Supabase after SMS success or keep WhatsApp-specific errors visible.
