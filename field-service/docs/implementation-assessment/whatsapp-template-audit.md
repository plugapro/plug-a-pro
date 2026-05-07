# CODEX-14 — WhatsApp Template and URL Audit

## Status
PASS (with one production bug fixed)

## URL helper
**Location:** `field-service/lib/provider-credit-copy.ts`
**Exported functions:** `getPublicAppUrl(path?)`, `getPublicAppUrlWithOptions(path, options?)`, `getWorkerPortalUrl(path?)`, `getProviderLeadPublicAppUrl(path?)`
**Env var used (resolution order):**
1. `APP_PUBLIC_URL` — server-side canonical domain (preferred in production)
2. `NEXT_PUBLIC_APP_URL` — Next.js client-visible fallback
3. `PROVIDER_LEAD_APP_URL` / `NEXT_PUBLIC_PROVIDER_LEAD_APP_URL` — optional provider-lead-specific override
4. Empty string fallback — callers receive `''` and must not emit a broken URL

**Safe path join:** YES — strips trailing slash from base, normalises double-leading slashes on paths via `replace(/^\/+/, '')`, never produces double-slash URLs.

**Production guard:** YES — in `NODE_ENV=production`:
- `localhost` or `127.0.0.1` as hostname → logs `console.error`, returns `''`
- Both env vars missing → logs `console.error`, returns `''`
- Non-absolute URL (no `https://`) → logs `console.error`, returns `''`
- `APP_PUBLIC_URL` missing but `NEXT_PUBLIC_APP_URL` present → logs `console.warn`, continues

**Note:** Guard logs but does NOT throw; callers receive `''` and silently skip the CTA URL rather than emitting a broken link. This is a deliberate graceful-degradation choice (WhatsApp delivery is best-effort). Acceptable for current risk level.

## Localhost scan
Files searched: all `field-service/lib/**/*.ts`

| File | Hit | Classification |
|------|-----|----------------|
| `lib/provider-credit-copy.ts:47,135,177,181` | `localhost` / `127.0.0.1` | Guard code (detection logic) — not emitted |
| `lib/whatsapp-flows/status.ts:477,487` | `support@plugapro.co.za` | Email address in message body — not a URL, does not trigger raw-URL guard |
| All other files | None | — |

**Status: CLEAN** — no production template emits `localhost` or `127.0.0.1` as a link.

## Bug fixed: raw URL in customer acceptance notification

**File:** `field-service/lib/selected-provider-acceptance.ts:479`

**Before (bug):**
```typescript
`Call-out fee: ${formatRand(params.callOutFee)}${ticketUrl ? `\n\nYou can view your request here: ${ticketUrl}` : ''}`
```
This embedded `ticketUrl` inline in the `sendText` body. `sendText` in `lib/whatsapp.ts` calls `assertNoRawUrlsInWhatsAppBody`, which would throw at runtime in production whenever a valid `ticketUrl` was present.

**After (fix):**
```typescript
`Call-out fee: ${formatRand(params.callOutFee)}` +
(ticketUrl ? `\n\nYour request details are available below.` : '')
```
The URL travels via the existing `sendCtaUrl` call at line 483 — unchanged.

## Provider template coverage

| Template | Present | Copy correct | URL helper used |
|----------|---------|--------------|-----------------|
| provider_onboarding_intro | YES (`buildProviderOnboardingIntroMessage`) | YES — previewing free, 1 credit on selected-job accept | URL-free body; terms via `getProviderTermsUrl()` CTA |
| provider_application_started | N/A — onboarding is WhatsApp-flow driven | — | — |
| provider_application_submitted | YES (`buildProviderApplicationSubmittedMessage`) | YES — review not automatic, starter credits on approval | URL-free body; terms via `getProviderTermsUrl()` CTA |
| provider_more_info_required | YES (`buildProviderApplicationMoreInfoRequiredMessage`) | YES — credit rules present, optional PWA | URL-free body; Worker Portal via `getWorkerPortalUrl()` CTA |
| provider_approved | YES (`buildProviderApplicationApprovedMessage`) | YES — starter credits awarded, credit rules, optional PWA | Worker Portal via `getWorkerPortalUrl('/provider')` CTA |
| provider_rejected | YES (`buildProviderApplicationRejectedMessage`) | YES — optional PWA / support framing | URL-free body; support via CTA |
| new_job_opportunity_preview | YES (`buildProviderLeadPreviewMessage`) | YES — previewing free, 1 credit only if selected + accepted | URL-free body; lead URL via dispatch.ts `sendCtaUrl` |
| provider_interest_captured | YES (`buildInterestSubmittedMessage`) | YES — no credit used, customer selects, then accept | URL-free body |
| provider_not_interested_captured | YES (`buildJobUnavailableMessage` with reason) | YES — no credits used | URL-free body |
| customer_selected_provider | YES (inline in `customer-shortlists.ts:notifySelectedProvider`) | YES — "Accepting this job uses 1 credit", balance shown | Lead URL via `sendCtaUrl` |
| selected_job_accepted (provider) | YES (`notifySelectedAcceptanceCommitted`) | YES — 1 credit used, full unlock details inline | Job URL via `sendCtaUrl` |
| selected_job_declined | YES (`declineSelectedProviderJob` + flow handler) | YES — no credit deducted | — |
| insufficient_credits | YES (`buildInsufficientCreditsMessage`) | YES — "No credit was deducted", top-up via portal | Top-up URL via CTA |
| credit_balance | YES (`buildProviderCreditSummaryMessage`) | YES — used only on accepted customer-selected job | Credit history via CTA |
| lead_expired | YES (`buildJobUnavailableMessage` reason=expired) | YES | — |

## Client template coverage

| Template | Present | Copy correct | URL helper used |
|----------|---------|--------------|-----------------|
| client_request_started | Partial (WhatsApp bot `job-request.ts` flow) | Managed via flow steps | — |
| client_request_submitted | YES (`notifyCustomerPwaRequestSubmitted`) | YES — shortlist expectation, privacy note | URL-free body; ticket URL via `sendCtaUrl` |
| client_matching_started | YES (`notifyCustomerMatchingInProgress`) | YES — providers being checked, shortlist promise | URL-free body |
| client_provider_responses_pending | Covered by `client_matching_started` copy | Acceptable overlap | — |
| client_shortlist_ready | YES (`notifyCustomerShortlistReady` in `customer-shortlists.ts`) | YES — "compare providers before choosing", privacy note | URL-free body; shortlist URL via `sendCtaUrl` |
| client_provider_selected | YES (`notifySelectedProvider` in `customer-shortlists.ts`) | YES — credit cost and Accept/Decline buttons | Lead URL via `sendCtaUrl` |
| client_provider_accepted | YES (`notifySelectedAcceptanceCommitted` customer branch) | YES — provider name, arrival, call-out fee | URL-free body (FIXED); ticket URL via `sendCtaUrl` |
| client_provider_declined | YES (`declineSelectedProviderJob` reverse + back to SHORTLIST_READY) | YES | — |
| client_more_options_needed | YES (`requestMoreShortlistOptions`) | No notification — silent reopen + re-match | — |
| client_job_scheduled | Covered by booking lifecycle templates | `booking_confirmation` in `messaging-templates.ts` | Template URL button |
| client_job_completed | YES — `job_completed` template in `messaging-templates.ts` | YES | Template URL button |

## Gaps closed

1. **Bug fix** — `field-service/lib/selected-provider-acceptance.ts:479`: removed inline `ticketUrl` from customer `sendText` body. URL now travels exclusively via `sendCtaUrl`. Would have thrown `assertNoRawUrlsInWhatsAppBody` at production runtime.
2. **Test update** — `field-service/__tests__/lib/provider-acceptance-credit-unlock.test.ts:359`: updated `'customer message: includes ticket URL in body text'` to `'customer message: ticket URL travels via sendCtaUrl — body text must not contain raw URL'`. Now asserts the corrected behavior.
3. **Test update** — `field-service/__tests__/lib/selected-provider-acceptance.test.ts`: added customer-body no-raw-URL assertion alongside the existing provider-body assertion.
4. **Test additions** — `field-service/__tests__/lib/provider-notifications-copy-and-url-rules.test.ts`: added 5 new test cases:
   - URL helper strips trailing slash and normalises double slashes
   - `getPublicAppUrl` returns `''` in production with no env vars set
   - `buildProviderLeadPreviewMessage` previewing-is-free copy verified
   - Customer-selected notification body copy verified (credit cost clear, no raw URL)
   - `selected_job_accepted_customer` body does not embed raw ticket URL (regression guard)

## Tests
**Total in `provider-notifications-copy-and-url-rules.test.ts`:** 38 (was 33, +5 new)

Key scenarios:
- All provider message bodies free of `localhost`, `127.0.0.1`, and `https://` in production env
- `getPublicAppUrl` blocks localhost in production; allows in development
- `getPublicAppUrl` returns `''` when no env vars configured
- URL helper safe path join (trailing slash, double slash)
- Credit rules: previewing/interest free; 1 credit only on selected-job accept
- Optional PWA framing: WhatsApp self-sufficient, Worker Portal additive
- Customer acceptance body no-raw-URL regression guard

**Full suite:** 1812 passing, 0 failing (167 test files, 4 todo)

## Files changed

- `field-service/lib/selected-provider-acceptance.ts` — fix raw URL in customer sendText body
- `field-service/__tests__/lib/selected-provider-acceptance.test.ts` — add customer body no-raw-URL assertion
- `field-service/__tests__/lib/provider-acceptance-credit-unlock.test.ts` — update test to assert correct behavior (URL via CTA not body)
- `field-service/__tests__/lib/provider-notifications-copy-and-url-rules.test.ts` — add 5 new test cases
