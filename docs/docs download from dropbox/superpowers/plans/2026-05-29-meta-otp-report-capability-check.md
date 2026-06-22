# Meta OTP Report Capability Check

> **For coworker:** This is a vendor/platform capability check, not an implementation task. Use read-only checks only. Do not change Plug A Pro code, submit or edit Meta templates, change feature flags, change WABA/phone/app settings, rotate secrets, or send production OTP traffic. If using Graph API, use `GET` only; do not run `POST`, `PATCH`, or `DELETE` requests.

**Goal:** Confirm the Meta-compliant path for putting an "I didn't request this code" report affordance in front of every provider who receives a WhatsApp OTP.

**Background:** Plug A Pro currently sends provider OTPs through the WhatsApp `otp_login` authentication template. The repo already has a fraud-response backend and a follow-up `otp_security_check` Utility template path, but that follow-up is currently signal-gated. The product requirement is stronger: every OTP must offer a one-tap report path.

**Accounts / identifiers to check:**
- Project: Plug A Pro
- WABA ID from current docs: `995389326374131`
- Existing auth template: `otp_login`
- Existing fallback Utility template: `otp_security_check`
- Locale: `en_ZA`

---

## Ask Meta / BSP

Contact Meta support, the BSP, or check Business Manager / Graph API docs for this exact capability. Identify the source of the answer because the confidence differs:

- Meta direct support
- BSP support
- Business Manager UI
- Graph API read-only response
- Public docs only

If the answer is docs-only, mark it as `Unknown` for WABA availability unless the docs explicitly say all WABAs have access.

### Read-only Pre-checks

Before contacting support, capture the current production template and account facts without changing anything:

- Current `otp_login` template status, category, language, and components.
- Current `otp_login` button/component shape, especially whether it is a copy-code authentication template.
- Whether `otp_login` is approved, pending, paused, rejected, or quality-limited.
- Current WABA id and phone number id shown in Business Manager.
- Current Graph API version used by the account/app if visible.
- Current webhook subscription fields if visible, especially whether button reply events are already delivered to the Plug A Pro webhook.

If using Graph API and you have read access, use only safe read calls such as:

```text
GET /<WABA_ID>/message_templates?name=otp_login
GET /<WABA_ID>/message_templates?name=otp_security_check
```

Do not paste access tokens or secrets into the final report.

### Primary Question

Does WABA `995389326374131` have access to Meta's native authentication-template button for reporting an unrequested OTP, described in current Meta docs as an "I didn't request a code" button?

If yes, confirm:
- Whether it can be enabled on the existing `otp_login` copy-code authentication template.
- Whether it is available for `en_ZA`.
- Whether it is GA, beta, allowlisted, or account-by-account.
- Whether any WABA-level, phone-number-level, app-level, or Graph API version requirement applies.
- Whether the button text is fixed by Meta or configurable.
- Whether the webhook payload is fixed, for example `DID_NOT_REQUEST_CODE`, or can carry a custom payload.
- Whether the webhook includes the original OTP message id in `context.id` or another field, so Plug A Pro can map the button tap back to the matching `otp_challenges.providerMessageId`.
- Whether the current Plug A Pro webhook subscription will receive this native button event without subscription or permission changes.
- A sample webhook payload for the native button tap, redacted if necessary.
- Whether the button can coexist with the copy-code button on the same authentication message.
- Whether template resubmission or new template approval is required.
- Whether there are volume, pricing, quality-rating, or policy risks when this button is enabled for every OTP.
- Whether enabling this button changes the authentication template category, pricing category, or user-visible template copy.

### Fallback Question

If the native authentication-template report button is not available, confirm that Meta policy permits an always-on Utility template immediately after every `otp_login`, containing one quick-reply button:

- Template name: `otp_security_check`
- Category: Utility
- Body: `Plug A Pro security check.\n\nWe just sent you a sign-in code. If you didn't request this, tap below to block it - your account stays safe.`
- Button: Quick reply
- Button label: `I didn't request this`
- Send timing: immediately after every successful `otp_login`, not only suspicious OTPs

Confirm:
- Whether this fallback could be rejected as authentication-related content in a Utility template.
- Whether sending this Utility message after every OTP is policy-compliant, not only after high-risk signals.
- Whether it creates one or two billable conversations/messages per OTP.
- Whether it creates quality-rating, block-rate, or template-pacing risk at expected OTP volume.
- Whether any wording change would improve approval chances.
- The exact approval-safe wording Meta/BSP recommends if the proposed body is risky.
- Whether the fallback should avoid words like `block`, `fraud`, `safe`, or `account` to reduce review risk.

---

## Evidence Required

Return evidence, not just a yes/no answer.

Provide:
- Screenshot or copied text from Meta/BSP support confirming availability.
- Link to the exact Meta docs page used.
- Screenshot of Business Manager template capability if visible.
- Screenshot or copied JSON of the current `otp_login` template, with secrets and phone numbers redacted.
- Any Graph API request/response shape Meta recommends.
- Sample webhook payload for the native button tap, or a written statement that Meta/BSP cannot provide one.
- Any support case number or BSP ticket reference.
- Explicit statement of whether production settings were changed. Expected answer: `No changes made`.

Do not include access tokens, app secrets, OTP codes, provider phone numbers, or customer/provider PII in the report.

---

## Output Format

Send the result back in this structure:

```markdown
# Meta OTP Report Capability Check Result

## Summary
- Native auth-template report button: Yes / No / Unknown
- WABA allowlisted: Yes / No / Unknown
- Can be used on `otp_login`: Yes / No / Unknown
- Existing webhook can receive native button event: Yes / No / Unknown
- Fallback Utility template allowed: Yes / No / Unknown
- Production changes made: No
- Source authority: Meta support / BSP support / Business Manager / Graph API / Docs only

## Current Template Snapshot
- `otp_login` status:
- `otp_login` category:
- `otp_login` language:
- `otp_login` components/buttons:
- `otp_security_check` status, if present:

## Native Button Details
- Availability:
- Enablement steps:
- Template impact:
- Button text:
- Webhook payload:
- Original message mapping field:
- Webhook subscription / permission impact:
- Pricing / policy notes:

## Fallback Utility Template Details
- Approval risk:
- Recommended wording:
- Timing allowed:
- Billable conversation/message impact:
- Pricing / policy notes:

## Evidence
- Docs link:
- Screenshot or ticket reference:
- Support/BSP contact:
- Sample payload or API response:

## Blockers
- Blocked on:
- Owner:
- Next action:
- Expected response date:

## Recommendation
- Use native auth button / Use always-on Utility fallback / Blocked pending Meta answer
- Reason:
```

---

## Decision Rule

Recommend the native auth-template button only if all of these are true:
- WABA `995389326374131` has access.
- It works with `otp_login` or a compliant replacement authentication template.
- The webhook lets Plug A Pro deterministically map the tap back to the OTP challenge, either by custom payload or original message id.
- The existing webhook subscription receives the native button event, or the required subscription change is clearly documented for engineering review.
- No production setting has to be changed before engineering reviews the answer.

If any of those are false, recommend the always-on Utility fallback and note the Meta approval risks.
