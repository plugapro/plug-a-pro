# PayAt Patch Plan

Last updated: 2026-05-23 17:30 SAST

## Status

Root cause is evidence-backed and a controlled disproof test confirms the smallest sufficient fix. Patch is implemented locally and awaiting validation/deploy.

## Evidence-backed root cause

Legacy `lib/payat/token.ts` requests an OAuth2 `client_credentials` access token **without specifying `scope`**. PayAt issues a scope-less token. Subsequent `POST /integrator/rtp/create/single/{merchantIdentifier}` calls return **HTTP 403 with an empty body** because the token lacks the `rtp:create:single` scope which Swagger explicitly requires for this endpoint.

Pay@Go (`lib/payat-go/client.ts:200`) already includes `scope: config.scopes.join(' ')` and is therefore unaffected by this bug.

## Disproof test result (Phase 3)

`GET /api/debug/payat-ping?key=…&variants=1` against the deployed production runtime:

| Variant | Scope sent | Token `scope` returned | RTP create result |
|---|---|---|---|
| `no_scope_baseline` (current production behaviour) | (none) | `(not returned)` | **HTTP 403, empty body** |
| `basic_scope_integrator` | `rtp:create:single` | `rtp:create:single` | **HTTP 200**, body `{requestToPayId:…, sourceReference:…, paymentLink:"https://payat.io/qr/…"}` |
| `basic_scope_merchant_endpoint` | `rtp:create:single` | `rtp:create:single` | **HTTP 200** against `/merchant/rtp/create/single`, same shape |

Variables held constant across all three: credentials, base URL, merchantIdentifier, request body, headers, IP origin, deployment runtime.
Variable changed: presence and content of the `scope` query parameter in the token request body.

This eliminates as causes: wrong base URL, wrong token URL, invalid credentials, merchant enablement, merchant identifier format, network/TLS, endpoint typo. The only remaining variable that affected outcome was `scope`.

## Proposed patch (single-file, smallest sufficient change)

**File:** `field-service/lib/payat/token.ts`

**Change:** Add `scope` to the token request body. Default to `rtp:create:single` (the only scope the disproof test verified). Allow override via a new optional env var `PAYAT_SCOPES` for parity with `PAYAT_GO_SCOPES`, so any future flow that needs `rtp:read` or `rtp:cancel:single` can opt in by env config without a code change.

```diff
 async function fetchToken(): Promise<string> {
   const tokenUrl = getTokenUrl()
   const clientId = requirePayatEnv('PAYAT_CLIENT_ID')
   const clientSecret = requirePayatEnv('PAYAT_CLIENT_SECRET')
+  // PayAt issues client_credentials tokens scoped to the requested OAuth
+  // scopes. Per Swagger, POST /integrator/rtp/create/single/{merchantId}
+  // requires `rtp:create:single`; without it PayAt returns HTTP 403.
+  // Default to the minimum proven scope; PAYAT_SCOPES env overrides
+  // (space-separated) once additional flows need rtp:read / rtp:cancel:single.
+  const scope = process.env.PAYAT_SCOPES?.trim() || 'rtp:create:single'

   let response: Response
   try {
     response = await fetch(tokenUrl, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/x-www-form-urlencoded',
         'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
       },
-      body: new URLSearchParams({ grant_type: 'client_credentials' }),
+      body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
       signal: AbortSignal.timeout(5_000),
     })
```

## Why this change and not another

- The disproof test held everything else constant. Adding scope was the only variable that turned 403 into 200. Per "do not change multiple variables at once", this is the smallest sufficient change.
- Defaulting to `rtp:create:single` only matches exactly what the disproof verified against the live endpoint. Going wider (read + cancel) would introduce two extra scopes that have not been tested against this specific client and could in principle be rejected at token-issue time if the client is not entitled to them.
- Making `PAYAT_SCOPES` env-driven (with a safe default) matches the Pay@Go convention (`PAYAT_GO_SCOPES`) so that any future provider-side flow needing `rtp:read` or `rtp:cancel:single` can opt in by env config without a code change.

## Alignment with Swagger contract

- `components.securitySchemes.OAuth2.flows.clientCredentials.tokenUrl` = `https://go.payat.co.za/yapi/oauth/token` (matches `PAYAT_TOKEN_URL` in production runtime).
- `components.securitySchemes.OAuth2.flows.clientCredentials.scopes` defines `rtp:create:single`, `rtp:read`, `rtp:cancel:single`, etc.
- `POST /integrator/rtp/create/single/{merchantIdentifier}` declares `security: [{"OAuth2": ["rtp:create:single"]}]`.

## Expected behaviour after fix

- Token request body becomes `grant_type=client_credentials&scope=rtp%3Acreate%3Asingle` (URL-encoded form of `rtp:create:single`).
- PayAt issues a JWT that includes the requested scopes (observed: 780-char token, vs. 740-char without scope).
- `POST /integrator/rtp/create/single/{merchantIdentifier}` returns HTTP 200 with `requestToPayId`, `sourceReference`, and `paymentLink`.
- `mapPayatResponse` in `lib/payat/payment.ts` successfully parses the response (it already accepts these fields).
- `/provider/credits` top-up flow completes end-to-end and the PaymentIntent transitions out of `PENDING_PAYMENT`.

## Tests

1. Add unit test to `field-service/__tests__/lib/payat-token.test.ts`:
   - Asserts that the request body sent to `PAYAT_TOKEN_URL` includes `scope=rtp:create:single` by default.
   - Asserts that setting `PAYAT_SCOPES` overrides the default scope string.
2. Run the existing legacy token suite (`__tests__/lib/payat-token.test.ts`) and the payment suite (`__tests__/lib/payat-payment.test.ts`) to confirm no regression.
3. Smoke-test in production after deploy: hit `/api/debug/payat-ping` (no `variants=1` needed) and verify the baseline now returns RTP HTTP 200 and the response body contains `requestToPayId`/`sourceReference`/`paymentLink`.

## Rollback plan

- Single commit, ~5 lines changed in one file.
- `git revert <sha>` restores prior behaviour.
- No DB migrations, no env-var changes are required (default scope ships in code; `PAYAT_SCOPES` is optional).

## Risks and edge cases

- **Token cache invalidation across the fix.** Existing in-flight tokens issued without scope live in process memory until `expires_in` (~1h) elapses. The next legacy provider-credit attempt after deploy will refresh the token because every fresh process starts cold. Risk: low.
- **PayAt scope-string ordering.** OAuth2 RFC 6749 §3.3 says scopes are space-delimited and order should not matter. The patch defaults to the single proven scope `rtp:create:single`; additional scopes can be supplied later through `PAYAT_SCOPES`.
- **A client not granted `rtp:read` or `rtp:cancel:single`.** The patch avoids this risk by not requesting read/cancel scopes unless explicitly configured.

## Out of scope for this patch (separate followup PRs)

- Remove temporary diagnostic logs in `lib/payat/payment.ts:144-151` and `:222-231`.
- Fix the misleading comment in `lib/payat/payment.ts:17-19` ("sourceReference and requestToPayId are returned by the merchant endpoint only" — the live response just proved integrator returns all three).
- Remove `PAYAT_DIAG_KEY` after live verification.
- Remove or further harden `/api/debug/payat-ping/route.ts` once the live flow is verified.
- Add `PAYAT_GO_MERCHANT_IDENTIFIER` to Vercel Production/Preview (blocks booking Pay@Go flow but is unrelated to this root cause).
- Rotate `PAYAT_DIAG_KEY` (currently shared in this session's chat history).

## Post-deploy verification checklist

1. `vercel inspect <new-prod-deployment-url>` returns Ready.
2. `curl ".../api/debug/payat-ping?key=…"` returns `token.scope=rtp:create:single …` and `rtp.status=200` with `requestToPayId`/`sourceReference`/`paymentLink` in `rtp.body`.
3. One real `/provider/credits` PayAt top-up attempt by a test provider completes and the PaymentIntent record contains a non-null `paymentLink` + `pspReference`.
4. Vercel runtime logs show `payat.rtp_response_ok` rather than `payat.rtp_create_failed` for that attempt.
