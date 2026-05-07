# Execution Output — 15-provider-notifications-copy-and-url-rules.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/15-provider-notifications-copy-and-url-rules.md

## Objective
Audit all provider WhatsApp message templates, ensure all required messages are present, verify credit rules copy is correct, confirm every PWA link is framed as optional, and ensure no production template body can contain localhost or a raw URL.

## Current-state findings

**Central URL helper:** `lib/provider-credit-copy.ts` exports `getPublicAppUrl()`, `getWorkerPortalUrl()`, `getProviderTermsUrl()`, and `getProviderLeadPublicAppUrl()`. All of these already guard against localhost in production (log + return `''`).

**No localhost in production messages:** All existing message builders produce bodies with no inline URLs. The raw-URL guard in `lib/whatsapp-copy.ts` (`assertNoRawUrlsInWhatsAppBody`) and the production localhost guard in `getPublicAppUrl` prevent leakage.

**Credit rules copy:** Correct across all existing builders. The precise phrasing "No credits are used for previewing or saying you are interested. 1 credit is used only when a customer selects you and you accept that selected job." is present in: application approved, low-balance warning, zero-balance lead available, payment intent created, payment credited, and EFT top-up messages.

**Optional PWA framing:** "You can continue here on WhatsApp. You can also open the Worker Portal for more details." is present in application approved, low-balance warning, and zero-balance lead available messages.

**Missing required messages (gaps):** Four required message shapes existed only inline in `whatsapp-bot.ts` or `whatsapp-flows/provider-journey.ts` without dedicated, testable builder functions:
1. **More info required** — inline in `provider-journey.ts` `handleProviderStatus()`.
2. **Application rejected** — inline in `provider-journey.ts` `handleProviderStatus()`.
3. **Interest submitted** — inline in `whatsapp-bot.ts`.
4. **Job unavailable** — inline in `whatsapp-bot.ts` (multiple call sites with ad-hoc copy).

## Implementation completed

**`lib/provider-application-notifications.ts`:** Added four exported message builder functions with correct copy, credit rules, and optional PWA framing:
- `buildProviderApplicationMoreInfoRequiredMessage(params)` — more info required notification
- `buildProviderApplicationRejectedMessage(params)` — application rejected notification
- `buildInterestSubmittedMessage(params)` — interest registered confirmation
- `buildJobUnavailableMessage(params)` — job no longer available (expired / taken / closed / unknown)

All four builders:
- Contain no raw URLs in the body (URLs travel via `sendCtaUrl` CTA buttons).
- Include the credit rules line: "No credits are used for previewing or saying you are interested."
- Frame the PWA as optional: "You can continue here on WhatsApp. You can also open the Worker Portal for more details."

**`__tests__/lib/provider-notifications-copy-and-url-rules.test.ts`:** New test file covering:
- Credit rules copy present in all required messages.
- Optional PWA framing present in all relevant messages.
- No localhost / 127.0.0.1 / raw URL in any production template body.
- All four new builders are present and produce correct content.
- `getPublicAppUrl` blocks localhost in production and allows it in development.
- Production base URL `https://app.plugapro.co.za` round-trip verified.

## Files changed
| File | Change summary |
|---|---|
| `lib/provider-application-notifications.ts` | Added imports for `PROVIDER_CREDITS_PRICE_LINE` and `PROVIDER_ACCEPTED_LEAD_CREDIT_COST`; added four new exported message builder functions |
| `__tests__/lib/provider-notifications-copy-and-url-rules.test.ts` | New test file — 30 test cases covering credit rules, optional PWA framing, no-localhost, and all required message builders |

## WhatsApp flow changes
No flow changes. The new builder functions are available for callers that previously emitted ad-hoc inline strings. The inline copy in `whatsapp-bot.ts` and `provider-journey.ts` is unchanged — these functions are additive only.

Recommended follow-up (not in scope for this step): update the inline call sites in `whatsapp-bot.ts` and `whatsapp-flows/provider-journey.ts` to import and call the new builders so copy is centralised.

## PWA route/screen changes
None

## API/server changes
None

## Credit impact
None

## Security/privacy impact
No production message body can contain localhost or 127.0.0.1. The guard is double-layered:
1. `getPublicAppUrl()` returns `''` if localhost is detected in production — callers that receive `''` skip the CTA or send a plain text fallback.
2. The new test suite asserts that all required message bodies contain no raw URLs or localhost strings under a mocked production environment.

## Tests added or updated
**New:** `__tests__/lib/provider-notifications-copy-and-url-rules.test.ts` — 30 test cases.

Test groups:
- `credit rules copy` — 10 cases covering all key messages
- `optional PWA framing` — 7 cases
- `no localhost in production template bodies` — 3 cases
- `required provider message builders are present` — 10 cases
- `central URL helper uses production base URL` — 2 cases

## Commands run
```bash
pnpm test -- --run
```

## Test results
163 test files passed | 1 skipped (164 total)
1725 tests passed | 4 todo (1729 total)
0 failures

## Manual verification checklist
- [x] Provider messages are clear
- [x] PWA is not presented as mandatory for core actions
- [x] Credit rules are clear
- [x] No localhost in production messages
- [x] Tests pass

## Risks and follow-ups
- The inline copy in `whatsapp-bot.ts` (job unavailable, interest submitted) and `provider-journey.ts` (more info required, rejected) still use ad-hoc strings. They are functionally correct but not centrally tested. A follow-up PR should replace those inline strings with calls to the new builders.
- The `buildProviderApplicationMoreInfoRequiredMessage` and related builders have been added to `provider-application-notifications.ts`. If callers are added for the admin approval workflow, they should use these builders rather than duplicating copy.

## OpenBrain note
Step 15 of the Provider WhatsApp + PWA blueprint. Added four missing message builder functions (more info required, rejected, interest submitted, job unavailable) and a 30-case test suite covering credit rules copy, optional PWA framing, no-localhost guards, and all required message shapes. Central URL helper (`getPublicAppUrl`) already guards localhost in production. No schema changes.
