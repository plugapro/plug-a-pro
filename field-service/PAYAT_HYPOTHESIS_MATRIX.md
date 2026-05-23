# PayAt Hypothesis Matrix

Last updated: 2026-05-23 16:30 SAST

Status values: `untested`, `supported`, `contradicted`, `eliminated`, `confirmed`.

| Hypothesis | Layer | Evidence for | Evidence against | Test performed | Result | Status | Confidence |
|---|---|---|---|---|---|---|---|
| Wrong PayAt base URL | Config/API | Legacy `.env.local.example` shows `PAYAT_TOKEN_URL=https://go.payat.co.za/yapi/v1/oauth/token`, but Swagger token URL is `/yapi/oauth/token`. | `PAYAT_API_BASE` and `PAYAT_GO_BASE_URL` are present in Vercel; API server URL is `/yapi/v1`. | Swagger extraction. | Token URL mismatch is supported, but actual runtime legacy value is encrypted and not yet verified. | supported | Medium |
| Sandbox vs production credential mismatch | Config/Auth | Vercel has separate Development/Preview/Production PayAt variables, and legacy/PayAtGo variable sets coexist. | Production runtime token request succeeds with current values. | Server-runtime diagnostic. | Still possible at merchant-product authorization layer, but not at OAuth token layer. | supported | Low |
| Invalid credentials | Auth | None after diagnostic. | Production runtime OAuth token request succeeds with HTTP 200. | Server-runtime diagnostic. | OAuth credentials are valid enough to obtain a token. | contradicted | High |
| Incorrect authentication scheme | Auth | Legacy client uses Basic auth; PayAtGo client uses form `client_id`/`client_secret`. Swagger says OAuth2 client credentials but does not prove which token request client authentication style PayAt accepts. | Both implementations use `grant_type=client_credentials`. | Source + Swagger inspection. | Needs controlled token calls for both styles if current style fails. | supported | Medium |
| Missing required header | API contract | PayAt returned 403 with empty body; unknown whether any non-Swagger header is required. | Swagger documents Bearer auth; diagnostic uses Bearer token and JSON content type. | Source + Swagger + server-runtime diagnostic. | Less likely than authorization/scope, but not eliminated. | supported | Low |
| Wrong endpoint path | API contract | Diagnostic uses Integrator path and gets 403; if credentials are merchant-mode, Merchant path may succeed. | Swagger confirms Integrator path exists and matches selected mode. | Swagger + server-runtime diagnostic. | Needs merchant-path disproof test. | supported | Medium |
| Malformed request payload | API contract | RTP create receives 403; a malformed payload typically produces 400/422, but PayAt body is empty so not conclusive. | Diagnostic sends required fields and valid amount; Swagger-required fields are present. | Swagger + server-runtime diagnostic. | Unlikely but not eliminated. | supported | Low |
| Amount format wrong | API contract | Webhook code has defensive rands/cents normalization, implying gateway variants may differ. | Swagger explicitly says monetary values are integer South African cents, and clients send integer cents. | Source + Swagger inspection. | Amount format for RTP create appears correct. | contradicted | Medium |
| Currency missing or wrong | API contract | None for create request; app internally validates ZAR. | Swagger RTP create schema does not include a currency field and states amounts are ZAR cents. | Source + Swagger inspection. | Not likely for create request. | contradicted | Medium |
| Invalid reference/order ID | API contract | Legacy client uses random 14-digit `clientAccountNumber` and PaymentIntent id as `clientReferenceNumber`; booking uses `BOOKING-{suffix}`. | No provider response proving invalid reference. | Source inspection. | Needs minimal test with same reference format. | untested | Low |
| Duplicate reference/idempotency issue | App/domain | Provider top-up flow has duplicate active intent guard; latest retests may reuse/block existing pending intents before PayAt call. | Logs did not show duplicate-intent action logs in captured output. | Runtime log scan. | Possible but unproven. | supported | Medium |
| Callback URL invalid or unreachable | Webhook/network | Production logs showed `/api/payat/webhook` returning 307 on earlier POSTs. A PSP callback typically expects a direct route response. | Controlled current POST to `https://app.plugapro.co.za/api/payat/webhook` returned HTTP 401 from the route with `x-matched-path: /api/payat/webhook`. | Vercel log scan + source inspection + controlled curl. | Current route is reachable; earlier 307 remains deployment/canonical-host/trailing-slash evidence, not current-route proof. | contradicted | Medium |
| Merchant not enabled for requested PayAt product | PSP setup | OAuth succeeds, Integrator RTP create returns HTTP 403. | Merchant path and explicit-scope token have not been tested yet. | Server-runtime diagnostic. | Strongly supported, but must disprove wrong credential mode/scope first. | supported | High |
| Merchant/account not enabled in target environment | PSP setup | OAuth succeeds, Integrator RTP create returns HTTP 403. | Env values point at production PayAt URLs and production app URL. | Server-runtime diagnostic. | Supported as authorization-layer cause. | supported | Medium |
| Frontend payload correct but backend transforms incorrectly | Frontend/backend | Server action path and API route parse amounts differently; latest phone test hit `/provider/credits` server action, not JSON API. | No captured frontend payload yet. | Source/log inspection. | Needs app trace. | untested | Medium |
| Backend request correct but response parsing wrong | App/API | Legacy `mapPayatResponse` requires `paymentLink`, but Swagger create response only requires `requestToPayId` and `sourceReference`; `paymentLink` is optional. | No live response body captured yet. | Source + Swagger inspection. | Supported but not confirmed. | supported | Medium |
| PayAt succeeds but database update fails | Persistence | DB update happens after PayAt call in provider top-up flow; failure could leave a PayAt request but no metadata. | No `payat.rtp_response_ok` or metadata failure log captured in latest window. | Source/log inspection. | Needs app trace. | untested | Low |
| Webhook arrives but is rejected or ignored | Webhook | `/api/payat/webhook` POST returned 307 in production logs; route requires `x-payat-signature`. | No route handler log captured for those webhook attempts. | Vercel log scan. | Needs controlled callback test and middleware/public path verification. | supported | Medium |
| App logs are hiding real PayAt error | Observability | Latest provider credit POST logs show middleware auth only; no action/provider error logs surfaced in captured Vercel query. | Temporary diagnostics exist in `lib/payat/payment.ts`, but they did not appear in available log query output. | Runtime log scan. | Needs correlated request trace, direct diagnostic endpoint, or request-id scoped logs. | supported | Medium |
| `PAYAT_GO_MERCHANT_IDENTIFIER` missing breaks booking PayAtGo flow | Config | `lib/payat-go/client.ts` requires it; Vercel env list does not show it. | Latest retest did not hit booking PayAtGo flow. | Source/env inspection. | Confirmed for booking flow readiness, not for latest provider-credit failure. | confirmed | High |
| Production env values are empty at runtime | Config | `vercel env pull` shows several PayAt values empty in the pulled file. | Server-runtime diagnostic confirms required values are present. | Local env preflight + server-runtime diagnostic. | Eliminated for legacy provider-credit runtime. | eliminated | High |

## Current Non-Root-Cause Conclusions

- The latest phone retest exercised the legacy provider wallet top-up surface, not the PayAtGo booking RTP surface.
- The PayAtGo booking flow is not currently ready in Production/Preview because `PAYAT_GO_MERCHANT_IDENTIFIER` is absent from Vercel env.
- These are findings, not the complete root cause of every PayAt failure. A minimal isolated API test using actual runtime credentials is still required.
- The local minimal test is blocked by unavailable pulled secret values; the next controlled test must run server-side in the deployed runtime or use local test credentials supplied securely.

## Current Leading Hypothesis And Disproof Test

| Field | Value |
|---|---|
| Leading hypothesis | Current OAuth client/merchant configuration is not authorized for Integrator RTP create on `/integrator/rtp/create/single/{merchantIdentifier}`. |
| Why supported | Production runtime env is present; OAuth token request succeeds; Integrator RTP create returns HTTP 403 with empty body. |
| Why not confirmed | A Merchant-mode endpoint test and explicit-scope token test have not yet been run. |
| Test that disproves it | Same credentials successfully create RTP using Merchant endpoint, or Integrator RTP succeeds after adding explicit `scope=rtp:create:single`. |
| Expected result if theory is wrong | Merchant path returns 201/2xx, or explicit-scope Integrator path returns 201/2xx. |
| Next step if disproved | Patch the app to use the proven credential mode or token scope, with tests asserting that exact request contract. |
