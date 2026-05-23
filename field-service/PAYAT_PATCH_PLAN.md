# PayAt Patch Plan

Last updated: 2026-05-23 16:00 SAST

## Status

No application payment-logic patch is approved yet.

Per investigation rules, application code must not be modified until:

1. Swagger/OpenAPI contract is extracted.
2. A minimal isolated PayAt API test is run with actual runtime credentials or local test credentials.
3. The app-generated request is compared with the minimal request.
4. A controlled test confirms the actual failure point.

Current blocker:

- Server-runtime diagnostic has narrowed the failure to PayAt RTP create authorization: token succeeds, Integrator RTP create returns HTTP 403.
- The next evidence step must distinguish wrong credential mode/scope from merchant enablement/account authorization.
- The diagnostic key was exposed in chat and should be removed or rotated after this round of testing.
- Local `.vercel/.env.production.local` is not equivalent to active production runtime; local token variants returned `invalid_client` while deployed runtime token succeeds.

## Disproof Gate Before Any Patch

Before any candidate fix is implemented, the leading theory must be tested in a way that can prove it wrong.

Current leading theory:

```text
The current OAuth client/merchant configuration is not authorized for Integrator RTP create.
```

Required disproof test:

```text
Run controlled one-variable tests inside deployed runtime:
1. Add explicit OAuth scope rtp:create:single to token request, then retry Integrator RTP create.
2. Use the same token/credentials against Merchant RTP create POST /merchant/rtp/create/single.
```

Patch decision rule:

- If explicit scope makes Integrator RTP succeed, patch token request scope handling.
- If Merchant endpoint succeeds and Integrator endpoint fails, patch endpoint mode/config to Merchant mode or obtain Integrator-enabled credentials from PayAt.
- If both return 403, escalate to PayAt for merchant/account/product authorization; do not patch app request shape.
- If either create succeeds, run the app flow once and compare response parsing/persistence against the successful minimal response.

## Candidate Fixes Not Yet Approved

| Candidate | Why It Is Candidate | Current Evidence | Status |
|---|---|---|---|
| Add `PAYAT_GO_MERCHANT_IDENTIFIER` to Vercel Production/Preview | Booking PayAtGo client requires it. | Confirmed missing in Vercel env list and required by code. | Config fix likely needed for booking flow, but not sufficient for provider top-up failure. |
| Run gated server-runtime PayAt diagnostic | Local minimal test cannot access production secrets. | Existing `/api/debug/payat-ping` route can test token + RTP create if protected by `PAYAT_DIAG_KEY`. | Recommended next controlled test before payment logic changes. |
| Restore successful production redeploy | Diagnostic key is not active on the live alias until a successful deployment includes it. | `vercel redeploy` produced ready deployment `plug-a-4hze9i0eo-*` and aliased `app.plugapro.co.za`. | Completed. |
| Add explicit token scope | PayAt may issue a token without RTP scope unless requested. | Current token response does not return scope; Integrator RTP create returns 403. | Diagnostic-only test needed before patch. |
| Test Merchant endpoint | Credentials may be Merchant-mode, not Integrator-mode. | Swagger has separate Merchant create endpoint without merchantIdentifier path; Integrator path returns 403. | Diagnostic-only test needed before patch. |
| Investigate `/api/payat/webhook` 307 redirect | Webhooks should not redirect. | Production logs show earlier 307 on webhook POST, but current controlled POST returns 401 from route. | Lower priority unless PayAt still reports callback redirects. |
| Align token URL(s) with Swagger | Legacy and PayAtGo token URL handling differ. | Source inspection shows different auth styles. | Needs Swagger and minimal token call evidence. |
| Remove temporary diagnostic logs after diagnosis | Current `lib/payat/payment.ts` contains temporary diagnostics. | Source inspection. | Cleanup after root cause is isolated. |
| Redact diagnostic endpoint and runtime logs | Current diagnostic/log code can expose endpoint path with merchant identifier and raw merchant identifier in some outputs. | `app/api/debug/payat-ping/route.ts` returns raw `PAYAT_MERCHANT_IDENTIFIER`; `lib/payat/payment.ts` logs raw `merchantIdentifier` and full endpoint. | Security cleanup should be included in eventual patch even if not root cause. |

## Rollback Plan Template

Any eventual code patch must be:

- Isolated to the confirmed failing layer.
- Covered by a regression test.
- Revertible by one commit.
- Safe for existing provider wallet and booking payment flows.
