# PayAt Hypothesis Matrix

Last updated: 2026-05-23 16:45 SAST

Status values: `untested`, `supported`, `contradicted`, `eliminated`, `confirmed`.

| Hypothesis | Layer | Evidence for | Evidence against | Test performed | Result | Status | Confidence |
|---|---|---|---|---|---|---|---|
| Wrong PayAt base URL | Config/API | Legacy `.env.local.example` showed stale `/yapi/v1/oauth/token`. | Production runtime uses Swagger token URL and API base; token succeeds; scoped Integrator RTP succeeds. | Swagger + runtime diagnostics. | Eliminated for provider-credit failure; local example corrected. | eliminated | High |
| Sandbox vs production credential mismatch | Config/Auth | Vercel has separate Development/Preview/Production PayAt variables, and legacy/PayAtGo variable sets coexist. | Production runtime token request and scoped RTP create both succeed with current values. | Server-runtime diagnostic + variant diagnostic. | Not the cause of provider-credit failure. | contradicted | High |
| Invalid credentials | Auth | None after diagnostic. | Production runtime OAuth token request succeeds with HTTP 200. | Server-runtime diagnostic. | OAuth credentials are valid enough to obtain a token. | contradicted | High |
| Incorrect authentication scheme | Auth | Legacy client uses Basic auth. | Basic auth with explicit scope returns token and scoped Integrator RTP succeeds. | Runtime variant diagnostic. | Basic auth is accepted. | contradicted | High |
| Missing required header | API contract | Initial unscoped RTP create returned 403. | Same headers succeed when token has `rtp:create:single`. | Runtime variant diagnostic. | Header set is sufficient. | contradicted | High |
| Wrong endpoint path | API contract | Initial unscoped Integrator RTP create returned 403. | Same Integrator endpoint succeeds with scoped token. | Runtime variant diagnostic. | Endpoint path is correct for current flow. | contradicted | High |
| Malformed request payload | API contract | Initial unscoped RTP create returned 403. | Same body succeeds with scoped token. | Runtime variant diagnostic. | Payload is not the cause of the 403. | contradicted | High |
| Amount format wrong | API contract | Webhook code has defensive rands/cents normalization, implying gateway variants may differ. | Swagger explicitly says monetary values are integer South African cents, and clients send integer cents. | Source + Swagger inspection. | Amount format for RTP create appears correct. | contradicted | Medium |
| Currency missing or wrong | API contract | None for create request; app internally validates ZAR. | Swagger RTP create schema does not include a currency field and states amounts are ZAR cents. | Source + Swagger inspection. | Not likely for create request. | contradicted | Medium |
| Invalid reference/order ID | API contract | Legacy client uses random 14-digit `clientAccountNumber` and PaymentIntent id as `clientReferenceNumber`; booking uses `BOOKING-{suffix}`. | No provider response proving invalid reference. | Source inspection. | Needs minimal test with same reference format. | untested | Low |
| Duplicate reference/idempotency issue | App/domain | Provider top-up flow has duplicate active intent guard; latest retests may reuse/block existing pending intents before PayAt call. | Logs did not show duplicate-intent action logs in captured output. | Runtime log scan. | Possible but unproven. | supported | Medium |
| Callback URL invalid or unreachable | Webhook/network | Production logs showed `/api/payat/webhook` returning 307 on earlier POSTs. A PSP callback typically expects a direct route response. | Controlled current POST to `https://app.plugapro.co.za/api/payat/webhook` returned HTTP 401 from the route with `x-matched-path: /api/payat/webhook`. | Vercel log scan + source inspection + controlled curl. | Current route is reachable; earlier 307 remains deployment/canonical-host/trailing-slash evidence, not current-route proof. | contradicted | Medium |
| Merchant not enabled for requested PayAt product | PSP setup | Initial unscoped RTP create returned 403. | Scoped Integrator RTP create succeeds. | Runtime variant diagnostic. | Merchant is enabled for RTP create when correct scope is requested. | contradicted | High |
| Merchant/account not enabled in target environment | PSP setup | Initial unscoped RTP create returned 403. | Scoped Integrator RTP create succeeds in production runtime. | Runtime variant diagnostic. | Account/environment is enabled for scoped RTP create. | contradicted | High |
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
- Root cause for the latest provider-credit Pay@ failure is confirmed: the legacy token request omitted `scope=rtp:create:single`.
- Booking PayAtGo remains a separate surface; `PAYAT_GO_MERCHANT_IDENTIFIER` still needs verification before booking payment tests.

## Current Leading Hypothesis And Disproof Test

| Field | Value |
|---|---|
| Leading hypothesis | The legacy Pay@ token request is missing required OAuth scope `rtp:create:single`. |
| Why supported | Production runtime unscoped token succeeds but Integrator RTP create returns 403; explicit scoped token succeeds and the same Integrator RTP create returns 200. |
| Why not confirmed | Confirmed by production variant diagnostic. |
| Test that disproves it | Scoped Integrator RTP create would still return 403. |
| Expected result if theory is wrong | Explicit `scope=rtp:create:single` token would not change the RTP result. |
| Next step if disproved | Not disproved; patch token request to include scope. |
