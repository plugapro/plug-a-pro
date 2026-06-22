# Phase-2: OTP security-check delivery template + native auth-button support

**Status:** Implemented behind existing `security.otp.report` feature flag (default-off). Default mode remains the approved two-message `otp_security_check` utility follow-up. `OTP_SECURITY_REPORT_DELIVERY_MODE=native_auth_button` enables Meta's native authentication-template "I didn't request a code" path only after WABA beta access and auth-template approval are confirmed.

**Closes:** F-5 (Medium) from the 2026-05-27 OTP fraud-response threat model — "Phase-2 report-token delivery template not yet wired".

## What this delivers

The OTP fraud-response feature (PR #6) shipped with full response machinery — report-token mint + persist + verify + apply-lock — but no path to actually put the report token in front of the user. Until now, an unrequested OTP would arrive on the victim's WhatsApp with no way for them to flag it. This adds the missing user-facing trigger.

## Design

### Delivery mode

`OTP_SECURITY_REPORT_DELIVERY_MODE` controls how the report affordance is delivered:

| Mode | Behavior | Use when |
|---|---|---|
| `utility_followup` | Send `otp_login`, then send the approved `otp_security_check` UTILITY template with an `otp_report_<reportToken>` quick-reply payload. | Default safe fallback; works with current approved templates. |
| `native_auth_button` | Send only the authentication OTP message and expect Meta's native `DID_NOT_REQUEST_CODE` button webhook. The app correlates webhook `context.id` to `otp_challenges.providerMessageId`. | Only after Meta confirms WABA `104200042667877` has beta access and the auth template is approved. |

### Trigger model: always-on, with signal metadata

In `utility_followup` mode, the security-check prompt fires after every successful WhatsApp OTP while `security.otp.report` is enabled. Fraud signals are still evaluated for metadata and logging, but absence of a signal falls back to the explicit `always_on` trigger. This gives every OTP a one-tap report affordance while preserving signal context for suspicious sends. Three optional signals are OR-combined, first-match-wins:

| Signal | Window | Threshold | Captures |
|---|---|---|---|
| `send_velocity` | last 60 min | ≥3 sends to same `phoneE164` (inclusive of current) | OTP hammering |
| `ip_diversity` | last 30 min | ≥2 distinct `requestedIpHash` for same phone | Distributed sources |
| `prior_event` | last 14 days | Any `NEW` or `ACKNOWLEDGED` `security_event` row | Recurring suspicious patterns |
| `always_on` | current send | No signal matched, or signal evaluation failed | Baseline Strava-style report affordance |

Evaluation is best-effort. Any DB error returns "no signal" and the prompt still sends with `trigger=always_on`. The OTP delivery is already complete by the time we evaluate; the prompt is purely a follow-up.

In `native_auth_button` mode, the separate signal-evaluation/send block is skipped. Meta owns the inline report action and sends the fixed `DID_NOT_REQUEST_CODE` webhook if the user taps it.

### Template: `otp_security_check`

- **Category:** UTILITY (transactional, follow-up to existing service use).
- **Language:** `en_ZA` (matches existing templates).
- **Body** (no variables):
  > Plug A Pro security check.
  >
  > We just sent you a sign-in code. If you didn't request this, tap below to block it — your account stays safe.
- **Button:** ONE quick-reply, label "I didn't request this", payload variable `{{1}}` — at send time the payload is `otp_report_<reportToken>`.

The utility button payload format matches the existing inbound handler at `field-service/lib/whatsapp-bot.ts` (`OTP_REPORT_BUTTON_PREFIX = 'otp_report_'`) exactly. The handler strips the prefix, treats the remainder as the report token, calls `reportUnrequestedOtpFromWhatsApp({ token, fromPhoneE164 })`, and replies with the existing confirmation text.

The native Meta auth button uses fixed payload `DID_NOT_REQUEST_CODE`. The handler calls `reportUnrequestedOtpByWhatsAppMessageId({ providerMessageId: message.context?.id, fromPhoneE164 })`; the service finds the active challenge by `providerMessageId` and matching sender phone before applying the same report/lock flow.

### Sequencing

```
t=0      Supabase Auth fires send-sms hook
t+10ms   Record OTP challenge (codeHash + reportToken + reportTokenHash)
t+20ms   isDeliveryAllowed check (refuse if locked)
t+50ms   deliverOtp() → Meta otp_login template sent
t+~500ms otp_login message arrives on user's WhatsApp
t+550ms  utility_followup only: shouldSendSecurityCheck() evaluates optional signals
t+600ms  utility_followup only: sendOtpSecurityCheckBestEffort() fires with signal trigger or `always_on`
t+~1.5s  utility_followup only: otp_security_check message arrives
```

Order matters: OTP first, then the security check. Reversing the order would let a user with a quick finger report-and-block BEFORE the OTP arrives, which is confusing UX.

In native mode there is no second message; the report affordance is part of the Meta auth template and inbound `DID_NOT_REQUEST_CODE` carries the OTP message id in webhook context.

### Files added

| File | Purpose |
|---|---|
| `field-service/lib/otp-security-signals.ts` | Signal evaluator. Exports `shouldSendSecurityCheck({ phoneE164, now? })` returning `{ trigger, signalDetail? }`. Short-circuits on first match. Each query wrapped in a 1.5s timeout; any error returns `{ trigger: null }`. |
| `field-service/lib/otp-security-report-prompt.ts` | Outbound sender. Exports `sendOtpSecurityCheckBestEffort({ phone, reportToken, trigger, hookRequestId?, userId? })`. Best-effort with structured success/failure logging. Redacts the raw report token from any error message. |
| `field-service/lib/messaging-templates.ts` | Template registry entry for `otp_security_check` (UTILITY, en_ZA, no body parameters). |
| `field-service/app/api/auth/hooks/send-sms/route.ts` | Removes the old `void reportToken` placeholder, adds the signal-evaluate-and-send block after a successful `deliverOtp()`. Wrapped in `try/catch` for defence in depth. |

### Tests added

- `__tests__/lib/otp-security-signals.test.ts` (8 tests) — each signal matches/doesn't-match, short-circuit behavior, time-window predicates, fail-closed-on-error.
- `__tests__/lib/otp-security-report-prompt.test.ts` (4 tests) — template payload shape, inbound-handler-compatible button format, structured failure logging on template-not-approved, raw-token redaction in error messages.
- `__tests__/api/auth/hooks/send-sms-security-check.test.ts` (9 tests) — full hook wiring: flag-off skips, flag-on evaluates, native mode skips utility follow-up, signal-match fires, no-signal sends `always_on`, OTP-failure skips signal eval, signal-eval-throw falls back to `always_on`, send-throw isolated, after() detachment.
- `__tests__/lib/whatsapp-otp-report.test.ts` — inbound utility `otp_report_<token>` and native `DID_NOT_REQUEST_CODE` routing.
- `__tests__/lib/otp-security-config.test.ts` — report delivery mode default/fallback parsing.

## Pre-flight before flipping the flag

1. **Default fallback path:** keep `OTP_SECURITY_REPORT_DELIVERY_MODE=utility_followup`. Submit/verify the `otp_security_check` template to Meta WhatsApp Business Manager — see template definition below. Approval is typically minutes to a few hours.

2. **Verify Meta approval** — once approved, the template appears in WABA → Message Templates with status `APPROVED`. Until then, `sendTemplate` throws `[TEMPLATE_NOT_APPROVED]`, which the best-effort sender logs and swallows. Code path is safe to deploy before approval.

3. **Native path:** only set `OTP_SECURITY_REPORT_DELIVERY_MODE=native_auth_button` after Meta confirms WABA `104200042667877` can use the native authentication-template "I didn't request a code" beta and the corresponding auth template is approved. If this is enabled without WABA/template support, users will receive only the OTP message and no visible report affordance.

4. **Stage roll-out** — flip `security.otp.report` flag ON for one test user first via `FeatureFlag.enabledForUsers`. In utility mode, send one OTP and verify the security-check arrives with `trigger=always_on`. In native mode, send one OTP and verify the single OTP message shows Meta's inline "I didn't request a code" action. Confirm tapping the button locks the account and the inbound handler replies with the existing confirmation text.

5. **Global flip** — set `feature_flags.enabled = true` for `security.otp.report`. From this point all phones get either the utility follow-up or native inline report affordance, depending on `OTP_SECURITY_REPORT_DELIVERY_MODE`.

## Submitting the Meta template

Three ways, in order of preference.

### Option 1 — npm script (recommended)

From repo root (with production env loaded):

```bash
set -a && source field-service/.env.local && set +a
pnpm --filter field-service template:submit:otp-security-check
```

Or inline if you don't want to source .env.local:

```bash
WHATSAPP_ACCESS_TOKEN=EAAB... pnpm --filter field-service template:submit:otp-security-check
```

What it does:
1. POSTs the template definition (body + button label) to `https://graph.facebook.com/v18.0/<waba-id>/message_templates`.
2. Idempotent: if the template already exists (re-running for any reason), exits 0 with `{ ok: true, alreadyExists: true }`.
3. On success prints `{ ok: true, name, id, status, category }` — typically `status: PENDING` initially.
4. Prints the curl one-liner you can use to poll for approval.
5. On scope/permission failure, surfaces an actionable hint about the access token scope.

Script: `field-service/scripts/submit-otp-security-check-template.ts`. Never prints the token. Defaults to the WABA id that approved `otp_security_check` on 2026-06-02 (`104200042667877`) and accepts `WHATSAPP_BUSINESS_ACCOUNT_ID` override.

### Option 2 — Direct curl

If you don't have the repo locally but do have the token:

```bash
WABA_ID=104200042667877
ACCESS_TOKEN=EAAB...   # whatsapp_business_management scope

curl -s "https://graph.facebook.com/v18.0/${WABA_ID}/message_templates" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "otp_security_check",
    "language": "en_ZA",
    "category": "UTILITY",
    "components": [
      {
        "type": "BODY",
        "text": "Plug A Pro security check.\n\nWe just sent you a sign-in code. If you didn'\''t request this, tap below to block it — your account stays safe."
      },
      {
        "type": "BUTTONS",
        "buttons": [
          {
            "type": "QUICK_REPLY",
            "text": "I didn'\''t request this"
          }
        ]
      }
    ]
  }' | jq .
```

Poll for approval:

```bash
curl -s "https://graph.facebook.com/v18.0/${WABA_ID}/message_templates?name=otp_security_check" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" | jq '.data[] | {name,status,category,rejected_reason}'
```

### Option 3 — Meta Business Manager dashboard (fallback)

Use this if neither programmatic option is available.

| Field | Value |
|---|---|
| **Template name** | `otp_security_check` |
| **Category** | Utility |
| **Language** | English (South Africa) — `en_ZA` |
| **Header** | _(leave blank)_ |
| **Body** | `Plug A Pro security check.\n\nWe just sent you a sign-in code. If you didn't request this, tap below to block it — your account stays safe.` |
| **Footer** | _(leave blank)_ |
| **Buttons** | Quick reply, **one** button |
| **Button label** | `I didn't request this` |

The button payload variable is set at SEND time (`otp_report_<token>`), not at template definition time. No payload variable needs to be configured in the Dashboard.

## Template definition (reference)

Below is the exact template definition the submission script uses, in case Meta's reviewer needs to see the canonical form:

| Field | Value |
|---|---|
| **Template name** | `otp_security_check` |
| **Category** | Utility |
| **Language** | English (South Africa) — `en_ZA` |
| **Body** | `Plug A Pro security check.\n\nWe just sent you a sign-in code. If you didn't request this, tap below to block it — your account stays safe.` |
| **Footer** | _(leave blank)_ |
| **Buttons** | Quick reply, one button |
| **Button label** | `I didn't request this` |
| **Button payload variable** | Use the payload field with one variable `{{1}}` — at send time we substitute `otp_report_<token>` |

Notes for submission:
- No header.
- No body variables; the body is fully static.
- The button is a **Quick Reply** (not URL, not Phone Number, not Copy Code).
- The payload variable is the standard `{{1}}` notation Meta accepts in quick-reply buttons.

If Meta's reviewer asks for sample button payload values during approval, provide: `otp_report_eyJjaGFsbGVuZ2VJZCI6ImN1aWQzMnh4eHgifQ.AbCdEfGh0123456789abcdefABCDEF=` (a representative-shape payload — never paste a real production token).

## Rollback

Two paths:

1. **Flag off** — set `feature_flags.enabled = false` for `security.otp.report`. Stops both challenge recording AND security-check prompt delivery. Inbound report buttons still get processed (because the handler is unconditional) — acceptable because there's no outbound trigger anymore so no new tokens.

2. **Code revert** — plain `git revert` of this PR removes the wiring entirely. Template can stay registered in Meta with no harm.

## Operational notes

- **Cost:** UTILITY-category messages are cheaper than MARKETING. At pilot volume the doubling impact is negligible; at scale, signal-gating keeps message count near baseline (signals fire rarely on legitimate traffic).
- **Inbox clutter:** Users in the "happy path" (single OTP send, legitimate sign-in) see exactly the same number of messages as before — one OTP. Only suspicious patterns trigger the extra prompt.
- **False positives on `send_velocity`:** Legitimate users who accidentally request 3+ OTPs in an hour (e.g., misreading the code, trying again, etc.) will trigger the prompt. This is the correct behavior — the prompt is non-blocking; if they really did request, they ignore it.
- **Failure isolation:** Every layer fails closed. Signal eval timeout → no prompt. Send template throws → logged, no propagation. Signal eval throws → outer `try/catch` in the hook swallows. OTP delivery is never blocked by anything in this phase-2 path.
