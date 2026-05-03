# WhatsApp Customer Copy Guidelines

This document is the source of truth for WhatsApp customer-facing copy in Plug A Pro. The rules below are enforced by lint tests in `__tests__/lib/whatsapp-copy.test.ts`. Skipping or working around these rules is a regression.

## Two non-negotiable rules

### 1. No raw URLs in message bodies

WhatsApp body text must never contain a raw URL (`https://…`, `http://…`, `www.…`, or any production app host). URLs travel via **CTA URL buttons** (`sendCtaUrl`) or **template URL button components** — never inline.

WhatsApp body text is not HTML. There is no anchor tag. There is no Markdown link. Pasting a URL into the body shows it raw and looks unfinished. Use the WhatsApp-native button mechanism instead.

```ts
// ❌ Wrong
await sendText(phone, `Provider terms: ${getProviderTermsUrl()}`)

// ✅ Right
await sendButtons(phone, 'Provider terms and credit rules are available below.', [
  { id: 'check_status', title: 'Check Status' },
  { id: 'back_home', title: 'Main Menu' },
])
await sendCtaUrl(
  phone,
  'Provider terms and credit rules.',
  ctaLabelFor('credit_policy'),       // → "View credit policy"
  getProviderTermsUrl(),
)
```

The `WhatsAppCtaPurpose` enum and the `ctaLabelFor` helper in `lib/whatsapp-copy.ts` keep CTA labels short, action-based, and consistent across flows.

`assertNoRawUrlsInWhatsAppBody(body, context)` is available for runtime guards in non-production code paths and is exercised by tests against the known producers (`buildProviderApplicationSubmittedMessage`, `buildProviderOnboardingIntroMessage`, `buildLowBalanceWarningMessage`, `buildZeroBalanceLeadAvailableMessage`).

### 2. No app-centred phrasing

WhatsApp copy should never sound like the bot is asking permission for itself. The user is the centre of the journey. Use **"Should we…?"** not **"Shall I…?"**.

```ts
// ❌ Wrong
'Shall I continue?'
'Shall I submit your application?'
'Would you like me to retry?'

// ✅ Right
WHATSAPP_COPY.confirmContinue            // 'Should we continue?'
WHATSAPP_COPY.confirmSubmitApplication   // 'Ready to submit your application?'
WHATSAPP_COPY.confirmContinueShort       // 'Continue?'
```

The lint test rejects `Shall I`, `Would you like me to`, and `Do you want me to`. Bug fixes and new flows must use `WHATSAPP_COPY` constants from `lib/whatsapp-copy.ts` for continuation prompts.

## CTA purpose → label table

| Purpose | Label |
|---|---|
| `credit_policy` | View credit policy |
| `provider_terms` | View terms |
| `application_status` | Check status |
| `worker_portal` | Open dashboard |
| `booking_view` | View booking |
| `quote_view` | View quote |
| `quote_approval` | Approve quote |
| `payment` | Make payment |
| `invoice_view` | View invoice |
| `receipt_view` | View receipt |
| `job_card` | View job card |
| `support` | Contact support |
| `generic_details` | View details |

## Button label conventions

- ✅ Continue — affirmative continuation
- ✏️ Change skills / ✏️ Edit — let the user revise
- 📎 Add another file — additive media upload
- 🔍 Check status — query own state
- 🧾 View invoice — receipt / invoice viewing
- ✅ Approve quote — explicit assent
- ❌ Cancel — abort flow

WhatsApp button labels must be ≤ 20 characters. Shorter is better. See `WHATSAPP_COPY` in `lib/whatsapp-copy.ts` for canonical values.

## What's allowed in internal logs / admin tooling

- Admin-only WhatsApp messages (e.g. `sendAdminDispatchNeeded` in `lib/whatsapp.ts`) MAY include raw URLs in body — they're operational, not customer-facing.
- Server logs (e.g. `console.info`, structured event logs) MAY include URLs.
- `Attachment.uploadedBy`, `MessageEvent.payload`, audit records MAY include URLs.

The rule applies only to **customer-facing** WhatsApp message bodies.

## When in doubt

- If a message body needs a URL, refactor to add a `sendCtaUrl` follow-up alongside the body.
- If a continuation prompt needs new wording, add a constant to `WHATSAPP_COPY` instead of hard-coding it inline.
- If a CTA label doesn't fit any documented purpose, add a new value to `WhatsAppCtaPurpose` rather than passing a free-text label.
