# Native OTP Did-Not-Request Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add support for Meta's native authentication-template "I didn't request a code" button while keeping the current two-message `otp_security_check` template as a safe fallback.

**Architecture:** The OTP auth hook continues recording every challenge and storing the WhatsApp OTP message id. A new config mode controls whether the app sends the separate utility security-check prompt (`utility_followup`) or expects Meta's native auth-template report button (`native_auth_button`). The inbound WhatsApp router handles Meta's native `DID_NOT_REQUEST_CODE` button payload by resolving the webhook `context.id` back to `OtpChallenge.providerMessageId`, then reuses the existing account-lock/security-event flow.

**Tech Stack:** Next.js App Router route handlers, Vitest, Prisma, Supabase Auth Send SMS Hook, WhatsApp Cloud API webhooks/templates.

---

### Task 1: Add Native Report Mode Config

**Files:**
- Modify: `field-service/lib/otp-security-config.ts`
- Test: `field-service/__tests__/lib/otp-security-config.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `field-service/__tests__/lib/otp-security-config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getOtpSecurityConfig native report mode', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.OTP_SECURITY_REPORT_DELIVERY_MODE
  })

  async function loadConfig() {
    process.env.VITEST = 'true'
    const { getOtpSecurityConfig } = await import('@/lib/otp-security-config')
    return getOtpSecurityConfig()
  }

  it('defaults to the utility follow-up prompt for safe rollout fallback', async () => {
    await expect(loadConfig()).resolves.toMatchObject({
      reportDeliveryMode: 'utility_followup',
    })
  })

  it('accepts native_auth_button when Meta beta access is enabled for the WABA', async () => {
    process.env.OTP_SECURITY_REPORT_DELIVERY_MODE = 'native_auth_button'

    await expect(loadConfig()).resolves.toMatchObject({
      reportDeliveryMode: 'native_auth_button',
    })
  })

  it('falls back to utility_followup for unknown values', async () => {
    process.env.OTP_SECURITY_REPORT_DELIVERY_MODE = 'unsupported'

    await expect(loadConfig()).resolves.toMatchObject({
      reportDeliveryMode: 'utility_followup',
    })
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm exec vitest run __tests__/lib/otp-security-config.test.ts`

Expected: FAIL because `reportDeliveryMode` does not exist yet.

- [ ] **Step 3: Implement config**

Add to `field-service/lib/otp-security-config.ts`:

```ts
export type OtpSecurityReportDeliveryMode = 'utility_followup' | 'native_auth_button'

function envReportDeliveryMode(): OtpSecurityReportDeliveryMode {
  return process.env.OTP_SECURITY_REPORT_DELIVERY_MODE === 'native_auth_button'
    ? 'native_auth_button'
    : 'utility_followup'
}
```

Add `reportDeliveryMode: OtpSecurityReportDeliveryMode` to `OtpSecurityConfig`, and return `reportDeliveryMode: envReportDeliveryMode()` from `getOtpSecurityConfig()`.

- [ ] **Step 4: Run test and verify GREEN**

Run: `pnpm exec vitest run __tests__/lib/otp-security-config.test.ts`

Expected: PASS.

### Task 2: Skip Utility Follow-Up When Native Mode Is Active

**Files:**
- Modify: `field-service/app/api/auth/hooks/send-sms/route.ts`
- Test: `field-service/__tests__/api/auth/hooks/send-sms-security-check.test.ts`

- [ ] **Step 1: Write failing hook test**

In `send-sms-security-check.test.ts`, mock `getOtpSecurityConfig` and add:

```ts
it('does not send the separate utility prompt when native auth report mode is active', async () => {
  vi.mocked(getOtpSecurityConfig).mockReturnValueOnce({
    ...baseOtpSecurityConfig,
    reportDeliveryMode: 'native_auth_button',
  })

  const res = await POST(signed())
  await flushPhaseTwoWork()

  expect(res.status).toBe(200)
  expect(shouldSendSecurityCheck).not.toHaveBeenCalled()
  expect(sendOtpSecurityCheckBestEffort).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm exec vitest run __tests__/api/auth/hooks/send-sms-security-check.test.ts`

Expected: FAIL because the route still sends the utility follow-up.

- [ ] **Step 3: Implement skip**

Import `getOtpSecurityConfig` in `send-sms/route.ts`, compute `const reportDeliveryMode = getOtpSecurityConfig().reportDeliveryMode`, and change the phase-2 condition to:

```ts
if (securityOn && reportToken && reportDeliveryMode === 'utility_followup') {
```

- [ ] **Step 4: Run test and verify GREEN**

Run: `pnpm exec vitest run __tests__/api/auth/hooks/send-sms-security-check.test.ts`

Expected: PASS.

### Task 3: Report Native DID_NOT_REQUEST_CODE Webhooks

**Files:**
- Modify: `field-service/lib/otp-security.ts`
- Modify: `field-service/lib/whatsapp-bot.ts`
- Test: `field-service/__tests__/lib/whatsapp-otp-report.test.ts`
- Test: `field-service/__tests__/lib/otp-security.test.ts`

- [ ] **Step 1: Write failing bot test**

In `whatsapp-otp-report.test.ts`, add a native button message helper and assertion:

```ts
function nativeDidNotRequestMessage(contextId = 'wamid.otp.1', from = RAW_WHATSAPP_PHONE) {
  return {
    from,
    id: 'wamid.native.report.1',
    context: { id: contextId, from: from },
    type: 'button',
    button: { payload: 'DID_NOT_REQUEST_CODE', text: "I didn't request a code" },
    timestamp: String(Date.now()),
  }
}

it('handles Meta native DID_NOT_REQUEST_CODE button replies by OTP message context id', async () => {
  await processInboundMessage(nativeDidNotRequestMessage('wamid.otp.1'))

  expect(mockReportUnrequestedOtpByWhatsAppMessageId).toHaveBeenCalledWith({
    providerMessageId: 'wamid.otp.1',
    fromPhoneE164: PHONE_E164,
  })
  expect(mockSendText).toHaveBeenCalledWith(PHONE_E164, GENERIC_CONFIRMATION)
  expect(mockDb.conversation.upsert).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Write failing service test**

In `otp-security.test.ts`, add a test that seeds a SENT challenge with `providerMessageId`, calls `reportUnrequestedOtpByWhatsAppMessageId({ providerMessageId, fromPhoneE164 })`, and expects:
- challenge status becomes `REPORTED_UNREQUESTED`
- one `OTP_REPORTED_UNREQUESTED` security event is created with source `WHATSAPP_BUTTON`
- account state is locked and step-up required
- a mismatched phone does not report the challenge

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run __tests__/lib/whatsapp-otp-report.test.ts __tests__/lib/otp-security.test.ts
```

Expected: FAIL because `reportUnrequestedOtpByWhatsAppMessageId` does not exist and the router does not recognize `DID_NOT_REQUEST_CODE`.

- [ ] **Step 4: Implement service by message id**

In `otp-security.ts`, add:

```ts
export async function reportUnrequestedOtpByWhatsAppMessageId(params: {
  providerMessageId?: string | null
  fromPhoneE164: string
}): Promise<{ ok: true }> {
  const providerMessageId = params.providerMessageId?.trim()
  if (!providerMessageId) return { ok: true }

  return reportUnrequestedOtpByChallengeLookup({
    sourceChannel: 'WHATSAPP_BUTTON',
    findChallenge: (client, now) => client.otpChallenge.findFirst({
      where: {
        providerMessageId,
        phoneE164: params.fromPhoneE164,
        status: { in: ACTIVE_CHALLENGE_STATUSES },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    }),
  })
}
```

Refactor the existing token path to share the challenge transition logic so token reports and native message-id reports produce identical security events and locks.

- [ ] **Step 5: Implement router branch**

In `whatsapp-bot.ts`, add:

```ts
const META_DID_NOT_REQUEST_CODE_PAYLOAD = 'DID_NOT_REQUEST_CODE'
```

Before the `otp_report_` branch, handle:

```ts
if (reply.type === 'button_reply' && reply.id === META_DID_NOT_REQUEST_CODE_PAYLOAD) {
  const providerMessageId = message.context?.id ?? null
  try {
    const { reportUnrequestedOtpByWhatsAppMessageId } = await import('./otp-security')
    await reportUnrequestedOtpByWhatsAppMessageId({ providerMessageId, fromPhoneE164: phone })
  } catch (error) {
    console.error('[whatsapp-bot] otp_native_report: handler failed', {
      messageId: message.id,
      hasContextMessageId: Boolean(providerMessageId),
      phone: maskedPhone(phone),
      errorName: error instanceof Error ? error.name : typeof error,
    })
  }
  await sendText(phone, OTP_REPORT_CONFIRMATION_TEXT)
  return
}
```

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```bash
pnpm exec vitest run __tests__/lib/whatsapp-otp-report.test.ts __tests__/lib/otp-security.test.ts
```

Expected: PASS.

### Task 4: Document Rollout and Template Probe

**Files:**
- Modify: `field-service/.env.example`
- Modify: `field-service/.env.local.example`
- Modify: `docs/superpowers/specs/2026-05-27-otp-security-check-template-phase-2.md`

- [ ] **Step 1: Document env mode**

Add `OTP_SECURITY_REPORT_DELIVERY_MODE=utility_followup` to env examples with a note that `native_auth_button` may only be used after Meta confirms WABA access to the beta `DID_NOT_REQUEST_CODE` auth-template button.

- [ ] **Step 2: Document operational path**

Update the phase-2 spec to say:
- current default is two-message fallback
- native auth button is preferred long-term
- native mode requires Meta beta access and an approved auth template
- native webhook correlation uses `context.id` -> `otp_challenges.providerMessageId`

### Task 5: Verify and Ship

**Files:** all changed files.

- [ ] **Step 1: Run focused verification**

Run:

```bash
pnpm exec vitest run __tests__/lib/otp-security-config.test.ts __tests__/api/auth/hooks/send-sms-security-check.test.ts __tests__/lib/whatsapp-otp-report.test.ts __tests__/lib/otp-security.test.ts __tests__/lib/otp-security-report-prompt.test.ts
pnpm typecheck
pnpm lint
```

Expected: all pass.

- [ ] **Step 2: Run CI-class verification**

Run:

```bash
pnpm build:ci
```

Expected: pass.

- [ ] **Step 3: Commit and push**

Commit:

```bash
git add docs/superpowers/plans/2026-06-02-native-otp-did-not-request-code.md docs/superpowers/specs/2026-05-27-otp-security-check-template-phase-2.md field-service/.env.example field-service/.env.local.example field-service/__tests__/api/auth/hooks/send-sms-security-check.test.ts field-service/__tests__/lib/otp-security-config.test.ts field-service/__tests__/lib/otp-security.test.ts field-service/__tests__/lib/whatsapp-otp-report.test.ts field-service/app/api/auth/hooks/send-sms/route.ts field-service/lib/otp-security-config.ts field-service/lib/otp-security.ts field-service/lib/whatsapp-bot.ts
git commit -m "feat(security): support native OTP report button"
git push origin HEAD:main
```

Expected: fast-forward push to `main`, pre-push hooks pass, GitHub Actions pass.

