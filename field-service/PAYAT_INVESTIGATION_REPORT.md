# PayAt Integration Investigation Report

Last updated: 2026-05-23 16:30 SAST

## Objective

Isolate the real PayAt integration failure with evidence before making code changes. This report is currently at Phase 1: repository and configuration map.

## Investigation Guardrail

No code patch may proceed from a supported hypothesis alone.

Before patching, the current leading conclusion must be actively challenged with at least one controlled disproof test:

- The test must run against the same layer implicated by the hypothesis.
- The expected result must be stated before running it.
- If the result contradicts the hypothesis, the hypothesis must be downgraded and the investigation must return to evidence gathering.
- A root cause can be declared only after the same test either confirms the failure or eliminates plausible alternatives.

Current required disproof test:

```text
Hypothesis under test:
The failing /provider/credits PayAt journey is blocked before or during PayAt token/RTP creation because deployed runtime config/auth/API contract is not producing a successful minimal RTP create.

Test that would disprove it:
Run a server-side diagnostic in the deployed Vercel runtime or local test-credential environment that:
1. Confirms required PayAt env vars are present without printing raw values.
2. Requests an OAuth token from the Swagger token URL.
3. Sends the smallest Swagger-valid integrator RTP create request.
4. Logs redacted method, URL shape, request body, HTTP status, and response body preview.

Disproof condition:
If token acquisition and minimal RTP create both succeed, then config/auth/endpoint/basic payload are not the root cause of the phone failure. The investigation must move to app implementation, persistence, response parsing, duplicate intent handling, or frontend handling.
```

## Facts

- F-001: The repository contains two PayAt-related implementations: legacy provider wallet top-ups under `lib/payat/*` and booking PayAtGo RTP under `lib/payat-go/*`.
- F-002: The latest observed production retest window shows `POST /provider/credits`, which maps to provider wallet top-ups, not booking PayAtGo APIs.
- F-003: No `/api/payat-go/booking/*` requests were found in the latest observed production log window.
- F-004: Vercel has `PAYAT_GO_BASE_URL`, `PAYAT_GO_CLIENT_ID`, `PAYAT_GO_CLIENT_SECRET`, `PAYAT_GO_GRANT_TYPE`, `PAYAT_GO_SCOPES`, `PAYAT_GO_ENABLED`, and `PAYAT_GO_MOCK_MODE`.
- F-005: Vercel does not list `PAYAT_GO_MERCHANT_IDENTIFIER`.
- F-006: `lib/payat-go/client.ts` requires `PAYAT_GO_MERCHANT_IDENTIFIER` before any real PayAtGo API call.
- F-007: Production logs show `POST /api/payat/webhook` returned HTTP 307 at least twice in the last observed window.
- F-008: `proxy.ts` lists `/api/payat/webhook` and `/api/payat-go/callback` as public paths.
- F-009: Local shell environment does not have PayAt variables loaded unless an env file is explicitly loaded; Vercel env is the authoritative production config source for this phase.
- F-010: Swagger UI config exposes separate `integrator`, `merchant`, and `ecommerce` OpenAPI documents.
- F-011: Integrator and merchant standard RTP scopes are `rtp:create:single`, `rtp:read`, and `rtp:cancel:single`.
- F-012: Ecommerce scopes are different: `ecommerce:rtp:create:single`, `ecommerce:rtp:cancel:single`, and `ecommerce:generatecredentials`.
- F-013: PayAt OpenAPI token URL is `https://go.payat.co.za/yapi/oauth/token`.
- F-014: Standard integrator RTP create success is HTTP 201 and requires `requestToPayId` plus `sourceReference`; `paymentLink` is optional.
- F-015: A fresh production env pull exposes `PAYAT_TOKEN_URL` as `https://go.payat.co.za/yapi/oauth/token` and exposes `PAYAT_MERCHANT_IDENTIFIER` as present, but `PAYAT_API_BASE`, `PAYAT_CLIENT_ID`, `PAYAT_CLIENT_SECRET`, `PAYAT_WEBHOOK_SECRET`, and several `PAYAT_GO_*` values are empty in the pulled file.
- F-016: The local minimal PayAt API test was blocked before any network call because required values for the legacy provider-credit flow were unavailable in the pulled production env file.
- F-017: Because Vercel sensitive variables may be non-readable through `env pull`, F-015 does not alone prove that the deployed runtime has empty secrets.
- F-018: A controlled unauthenticated POST to `https://app.plugapro.co.za/api/payat/webhook` reached the route and returned HTTP 401 `Invalid signature`, with `x-matched-path: /api/payat/webhook`.
- F-019: Current production logs show `POST /provider/credits` reached middleware and authenticated successfully, but the available log queries did not surface a correlated outbound PayAt response.
- F-020: The latest production redeployment intended to include `PAYAT_DIAG_KEY` failed with Vercel build error: required git information could not be fetched.
- F-021: `https://app.plugapro.co.za` remains on the previous ready deployment `plug-a-5wkw3sif7-*`, created 2026-05-23 15:25 SAST.
- F-022: The diagnostic route `/api/debug/payat-ping` is reachable and protected; a request with an invalid key returned HTTP 403.
- F-023: Redeploying the previous ready production deployment through `vercel redeploy` succeeded.
- F-024: `https://app.plugapro.co.za` now aliases to ready deployment `plug-a-4hze9i0eo-*`, deployment id `dpl_D3jGtDP51fMrLpqxUACkpTqqG2rP`, created 2026-05-23 16:16 SAST.
- F-025: The diagnostic route remains protected after redeploy; invalid key requests still return HTTP 403.
- F-026: Server-runtime diagnostic confirms `PAYAT_TOKEN_URL`, `PAYAT_API_BASE`, `PAYAT_CLIENT_ID`, `PAYAT_CLIENT_SECRET`, `PAYAT_MERCHANT_IDENTIFIER`, and `NEXT_PUBLIC_APP_URL` are present in production runtime.
- F-027: Server-runtime diagnostic confirms PayAt OAuth token acquisition succeeds with HTTP 200 and returns an access token with `expiresIn=3599`.
- F-028: Server-runtime diagnostic confirms RTP create against `POST /integrator/rtp/create/single/{merchantIdentifier}` fails with HTTP 403 and an empty body.
- F-029: The diagnostic key was pasted into chat and should be removed or rotated after this investigation step.
- F-030: A local variant probe using `.vercel/.env.production.local` returned `invalid_client` for all token variants, while the deployed runtime token request succeeds. The local Vercel env file is therefore not equivalent to active production runtime and cannot prove the PayAt failure.

## Assumptions

- A-001: The current user-reported phone retest is the production app on `app.plugapro.co.za`.
- A-002: The failing user journey is currently provider wallet top-up unless the user separately triggers a booking payment route.
- A-003: PayAt merchant identifiers are treated as sensitive enough to redact in reports.
- A-004: Swagger/OpenAPI will define the final contract for token URL, scopes, endpoints, payloads, and callback rules.

## Initial Conclusions

- C-001: The investigation must not merge the legacy `PAYAT_*` top-up flow and `PAYAT_GO_*` booking flow into one diagnosis. They use different env vars, routes, storage models, and callback endpoints.
- C-002: The PayAtGo booking flow has a confirmed runtime config gap: `PAYAT_GO_MERCHANT_IDENTIFIER` is missing from Vercel Production/Preview.
- C-003: The latest retest does not prove whether PayAtGo booking RTP works or fails because it did not hit `/api/payat-go/*`.
- C-004: Legacy provider top-up failure is not isolated yet. It needs a minimal external PayAt API test plus a correlated app trace.
- C-005: The observed 307 on `/api/payat/webhook` is suspicious for webhook delivery and needs controlled reproduction.
- C-006: The current endpoint mode is aligned with the standard integrator RTP contract, not the ecommerce RTP contract.
- C-007: Legacy provider top-up response parsing may be too strict because it requires `paymentLink`, while Swagger marks only `requestToPayId` and `sourceReference` as required. This is not root cause yet because no live response has been captured.
- C-008: The minimal external API test cannot currently distinguish credentials/PSP setup from app-runtime behaviour because production secrets are not available to the local probe.
- C-009: The next controlled test must execute server-side in the deployed runtime, using redacted diagnostics only, or the user must provide test credentials in a local-only env file.
- C-010: The current webhook route is reachable on the production host; the earlier 307 events are not reproduced by the current direct-path test.
- C-011: The deployment blocker has been cleared. The next step is to call the diagnostic route with the real `PAYAT_DIAG_KEY` and capture redacted token/RTP results.
- C-012: Missing production runtime env vars and OAuth token acquisition failure are now contradicted for the legacy provider-credit flow.
- C-013: The active failure boundary is the PayAt RTP create authorization step: OAuth succeeds, but Integrator RTP create returns HTTP 403.
- C-014: Do not patch request payload parsing or frontend flow yet; those layers are downstream of the current confirmed 403 boundary.
- C-015: Further disproof tests must run in deployed runtime, not from the local `.vercel/.env.production.local` file.

## Phase 1 Artifacts

- `PAYAT_FLOW_MAP.md`
- `PAYAT_HYPOTHESIS_MATRIX.md`
- `PAYAT_REQUEST_RESPONSE_LOG.md`
- `PAYAT_SWAGGER_CONTRACT_CHECKLIST.md`
- `PAYAT_PATCH_PLAN.md`

## Next Required Phase

Phase 3 has produced a server-runtime result: token acquisition succeeds, RTP create returns HTTP 403.

Next required disproof test before patching:

1. Test whether the same credentials are authorized for Merchant RTP create (`POST /merchant/rtp/create/single`) without the merchant identifier path.
2. Test whether adding explicit OAuth scope `rtp:create:single` changes the Integrator RTP create result.
3. If both still return 403, escalate to PayAt support with the redacted evidence and ask them to confirm whether the OAuth client is enabled for Integrator RTP create for the merchant identifier.

No application payment logic should be changed before these tests distinguish wrong credential mode/scope from PSP-side merchant enablement.
