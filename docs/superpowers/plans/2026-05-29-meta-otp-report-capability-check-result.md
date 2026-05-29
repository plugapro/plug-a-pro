# Meta OTP Report Capability Check Result

> Read-only check executed against Meta public WhatsApp Business Platform docs on 2026-05-29. No Plug A Pro code, templates, flags, WABA/phone settings, secrets, or production traffic were touched. No Graph API calls were made — the WABA token is not held by this agent, so the Graph API read-only pre-checks listed in the instruction (`GET /<WABA_ID>/message_templates?name=...`) are still outstanding and need to be run by someone with credentials.

## Summary
- Native auth-template report button: **No** (not present in Meta's public Authentication Templates doc as of 2026-05-29)
- WABA allowlisted: **Unknown** (cannot verify from docs alone — BSP/Meta support required)
- Can be used on `otp_login`: **No** in public-docs terms. Meta's copy-code authentication template spec only allows the single copy-code button; one-tap, copy-code, and zero-tap are the only documented button variants. Any "report" button would have to be a Meta-side feature that isn't yet public.
- Existing webhook can receive native button event: **Unknown** (no such payload is documented; not testable until Meta confirms the feature exists for this WABA)
- Fallback Utility template allowed: **Yes, with wording risk.** Meta does not prohibit a Utility template sent after an auth template, but Meta will reject or reclassify Utility templates that contain authentication-related content. The current proposed body ("We just sent you a sign-in code…") is at meaningful risk of rejection or reclassification to Authentication / Marketing.
- Production changes made: **No**
- Source authority: **Docs only** (Meta for Developers + secondary BSP and analyst pages). No Meta or BSP support ticket was opened; no Business Manager UI was inspected; no Graph API calls were made.

## Current Template Snapshot
Not captured. The instruction asks for `otp_login` and `otp_security_check` template state via `GET /<WABA_ID>/message_templates?name=...`. The agent does not hold the Graph access token, so this read was skipped. **Action for the WABA-credentialed reviewer:** run those two GETs and paste the redacted JSON into this section before this result is treated as complete.

- `otp_login` status: TBD
- `otp_login` category: TBD (expected: AUTHENTICATION)
- `otp_login` language: TBD (expected: en_ZA per docs)
- `otp_login` components/buttons: TBD (expected: copy-code button)
- `otp_security_check` status, if present: TBD

## Native Button Details
- Availability: Not described in Meta's current Authentication Templates documentation. The doc enumerates one-tap autofill, copy-code, zero-tap, and (from 15 June 2026 on iOS 26+) passive Keyboard Suggestions. No "I didn't request this code", "report", "security check", or "fraud" button appears in the public spec. If this capability exists, it is either undocumented, partner-led, or in private allowlist — none of which can be confirmed from docs alone.
- Enablement steps: Unknown.
- Template impact: Meta's copy-code authentication template spec states only the copy-code button is permitted on a copy-code auth template. Adding a second button would, on current public spec, require a new authentication template variant from Meta. Cannot be inferred from existing docs.
- Button text: Unknown — no public reference.
- Webhook payload: Not documented. Meta's auth-template doc only references status webhooks (sent / delivered / read) for OTP buttons. No `DID_NOT_REQUEST_CODE` payload is published.
- Original message mapping field: Unknown. For standard quick-reply / interactive-button webhooks, Cloud API populates `messages[].context.id` with the originating message id, but this is the generic Cloud API behaviour and has not been confirmed for any "report unrequested OTP" payload because no such payload is documented.
- Webhook subscription / permission impact: Unknown. Cannot be tested without Meta confirming the feature exists.
- Pricing / policy notes: Auth pricing tables apply per phone number / region. Whether enabling a report button would shift the message into a different pricing category is not documented. No quality-rating guidance for the button exists.

## Fallback Utility Template Details
- Approval risk: **Medium to high** with the current proposed body. Meta's Template Categorization rules explicitly state that Marketing or Utility templates containing authentication content are rejected (not reclassified — rejected). Phrasing like "We just sent you a sign-in code" reads as authentication content and is the exact pattern Meta's reviewers flag. From April 2025, Meta reclassifies or rejects without 24-hour notice for repeat offenders.
- Recommended wording: Rework the body to avoid the terms `code`, `OTP`, `sign-in`, and `verification`. Frame it as an account-change notice tied to the user's recent action, not as a follow-up to a credential delivery. Suggested draft for Meta review:

  > `Plug A Pro account check.\n\nWe just received a sign-in attempt on your account. If this was not you, tap below and we will block it.\n\nReply STOP to opt out of account alerts.`

  The button label `I didn't request this` is fine as a quick-reply payload (developer-defined payload up to 256 chars, label up to 25 chars). If Meta still flags it, fall back to `Not me` or `Block this attempt`.
- Timing allowed: Meta does not document a prohibition on sending a Utility template immediately after an Authentication template. Each is a separate message governed by its own template approval and the standard 24-hour customer-service / template rules. No per-OTP throttling is documented.
- Billable conversation/message impact: Each `otp_security_check` send is a separate billable Utility-category message under Meta's per-message pricing model. At expected OTP volume this roughly doubles per-OTP messaging cost (one Authentication + one Utility per login). At very high volume this materially affects template pacing and quality-rating exposure on the Utility template specifically — if the report button is rarely tapped, the template may accumulate "read but not actioned" signal that does not hurt directly, but if customers ignore or block, quality rating on the Utility template can drop.
- Pricing / policy notes: Authentication template pricing varies by region (Twilio publishes ZAR / ZA rates separately); a doubled per-OTP send increases ZA cost by the per-Utility rate for that corridor. None of the per-corridor rates are quoted here because they are not the operative question — the operative question is whether the Utility content will be approved at all. Wording is the blocker, not price.

## Evidence
- Docs link (primary): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates/
- Docs link (copy-code auth template spec): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/
- Docs link (one-tap autofill spec): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/autofill-button-authentication-templates/
- Docs link (template categorization rules): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- Docs link (utility templates): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates/
- Screenshot / Business Manager view: not captured (read-only check via public docs, no BM login by the agent).
- Support / BSP ticket reference: none — this check did not open a Meta or BSP case.
- Sample payload or API response: none. Meta does not publish a sample webhook payload for an "I didn't request a code" tap because no such button is documented.

## Blockers
- Blocked on:
  1. A definitive Meta or BSP answer on whether WABA `995389326374131` is allowlisted for any non-public "report unrequested OTP" button on authentication templates.
  2. Read-only Graph API capture of the current `otp_login` and `otp_security_check` template JSON.
  3. Meta or BSP confirmation that the proposed `otp_security_check` body wording would be approved as Utility (not rejected as authentication content, not reclassified).
- Owner: Plug A Pro lead (Lebogang) to open the BSP ticket and run the two Graph GETs, or to delegate.
- Next action: Open a BSP ticket attaching this result doc. Request: (a) confirmation in writing that no native authentication-template "report" button is currently available for this WABA, (b) approval-safe wording for the Utility fallback, (c) confirmation of any pricing-category impact for sending Utility immediately after every auth OTP.
- Expected response date: assume 3–5 business days from ticket open (BSP standard SLA). Re-open this doc once the answer is back.

## Recommendation
**Blocked pending Meta / BSP answer. If forced to choose today, ship the always-on Utility fallback — but only after the body is reworded and re-approved.**

- Reason: Meta's public Authentication Templates documentation does not describe a native "I didn't request a code" button on authentication templates as of 2026-05-29. The copy-code auth template spec only permits the copy-code button. Until Meta or the BSP confirms a non-public allowlist or beta on this WABA, the native button cannot be relied on for the product requirement that **every** OTP carry a one-tap report path. The Utility-template fallback is the only documented option that puts a quick-reply button in front of every provider after every OTP, and Meta does not prohibit it — but the proposed body is at real risk of being rejected as authentication content. The right next step is therefore (a) BSP confirmation on the native button, and in parallel (b) reword the Utility body and resubmit `otp_security_check` for approval. No production changes should be made until both answers are back and engineering has signed off.
