# PayAt Request/Response Evidence Log

Last updated: 2026-05-23 16:00 SAST

All credentials, tokens, merchant identifiers, phone numbers, and user identifiers must remain redacted or masked.

## Runtime Log Evidence

### E-012: Latest Retest Route Surface

Source: Vercel production logs, last observed phone retest window.

Redacted evidence:

```text
2026-05-23 15:33 SAST
POST /provider/credits
HTTP 200
worker-provider-auth finalDecision=OK
providerId=[redacted]
phone=[masked]
```

Interpretation:

The latest retest exercised the provider wallet top-up page/server action route, not the booking PayAtGo API route.

### E-013: Legacy PayAt Webhook Redirect

Source: Vercel production logs.

Redacted evidence:

```text
2026-05-23 approx 13:14 SAST
POST /api/payat/webhook
HTTP 307

2026-05-23 approx 13:52 SAST
POST /api/payat/webhook
HTTP 307
```

Interpretation:

A PayAt callback endpoint returning redirect is suspicious because PSP webhooks normally require a direct 2xx/4xx route response. The redirect target and trigger are not yet proven.

### E-014: Current Webhook Reachability Check

Source: controlled unauthenticated `curl` request from local shell to production.

Redacted request:

```text
POST https://app.plugapro.co.za/api/payat/webhook
content-type: application/json
body: {}
```

Redacted response:

```text
HTTP 401
x-matched-path: /api/payat/webhook
body: {"error":"Invalid signature"}
```

Interpretation:

The current production deployment can route directly to `/api/payat/webhook`; the route handler is reachable and rejects unsigned payloads. This contradicts the hypothesis that the endpoint always redirects. Earlier HTTP 307 events may have been deployment/canonical-host/trailing-slash specific and remain separate evidence.

### E-015: Minimal External API Test Preflight

Source: `vercel env pull /tmp/plugapro-payat-production.env --environment=production --yes`, followed by a local Node probe that redacts values and refuses to call PayAt unless required config is available.

Redacted config shape:

```json
{
  "PAYAT_TOKEN_URL": "https://go.payat.co.za/yapi/oauth/token",
  "PAYAT_API_BASE": "empty in pulled file",
  "PAYAT_CLIENT_ID": "empty in pulled file",
  "PAYAT_CLIENT_SECRET": "empty in pulled file",
  "PAYAT_MERCHANT_IDENTIFIER": "set:10chars",
  "PAYAT_WEBHOOK_SECRET": "empty in pulled file",
  "PAYAT_GO_BASE_URL": "empty in pulled file",
  "PAYAT_GO_CLIENT_ID": "empty in pulled file",
  "PAYAT_GO_CLIENT_SECRET": "empty in pulled file",
  "PAYAT_GO_MERCHANT_IDENTIFIER": "absent"
}
```

Probe result:

```text
outcome: blocked_before_network_call
missing_for_external_legacy_test:
- PAYAT_API_BASE
- PAYAT_CLIENT_ID
- PAYAT_CLIENT_SECRET
```

Interpretation:

The minimal external API test cannot be completed from local CLI using the pulled production env because required values are unavailable in the pulled file. Because Vercel sensitive variables may not be recoverable through `env pull`, this does **not** by itself prove the deployed runtime has empty values. It proves only that a local external test cannot currently use the same production credentials without a secure runtime diagnostic path or the user supplying test credentials locally.

### E-016: Latest Provider Credits Runtime Logs

Source: Vercel production logs, last two hours, redacted.

Redacted evidence:

```text
2026-05-23 15:33 SAST
POST /provider/credits
HTTP 200
worker-provider-auth finalDecision=OK

No matching downstream `payat.rtp_response` log found.
No matching `PayatConfigError` log found via query.
```

Interpretation:

The authenticated server action route was reached. The available Vercel query output does not yet show a correlated outbound PayAt call or a structured action-layer failure. This keeps the latest provider-credit failure unresolved at the app-runtime layer.

### E-017: Diagnostic Key Deployment Attempt

Source: `vercel inspect` on the latest production deployment URL.

Redacted evidence:

```text
Deployment URL: plug-a-8kgazqbd6-[team].vercel.app
Target: production
Status: Error
Created: 2026-05-23 16:11 SAST
Build log: We were unable to fetch required git information required to complete the deployment.
```

Current live alias:

```text
https://app.plugapro.co.za
Deployment URL: plug-a-5wkw3sif7-[team].vercel.app
Status: Ready
Created: 2026-05-23 15:25 SAST
```

Controlled route probe:

```text
GET /api/debug/payat-ping?key=__missing__
HTTP 403
x-matched-path: /api/debug/payat-ping
body: {"error":"forbidden"}
```

Interpretation:

The diagnostic route is deployed and protected, but the latest redeploy that should bake in `PAYAT_DIAG_KEY` failed. The production alias is still serving the previous ready deployment. The PayAt diagnostic cannot run until a successful production deployment includes the new `PAYAT_DIAG_KEY`, or until the diagnostic key from an already-active deployment is available.

### E-018: Production Redeploy Restored

Source: `vercel redeploy` of the previous ready production deployment, followed by `vercel inspect`.

Redacted evidence:

```text
Redeployed from previous ready production deployment.
New deployment URL: plug-a-4hze9i0eo-[team].vercel.app
Deployment id: dpl_D3jGtDP51fMrLpqxUACkpTqqG2rP
Target: production
Status: Ready
Created: 2026-05-23 16:16 SAST
Aliases:
- https://app.plugapro.co.za
- https://admin.plugapro.co.za
```

Diagnostic route guard check:

```text
GET /api/debug/payat-ping?key=__missing__
HTTP 403
x-matched-path: /api/debug/payat-ping
body: {"error":"forbidden"}
```

Interpretation:

Production deployment is restored and the diagnostic route is live/protected. The actual PayAt diagnostic still requires calling the endpoint with the real `PAYAT_DIAG_KEY`; placeholder or missing keys correctly return 403.

### E-019: Server-Runtime PayAt Diagnostic Result

Source: user-run `curl` against the gated production diagnostic endpoint after successful redeploy.

Security note:

The diagnostic key and raw merchant identifier were pasted into chat. The diagnostic key must be removed from Vercel or rotated after this investigation step.

Redacted request:

```text
GET https://app.plugapro.co.za/api/debug/payat-ping?key=[REDACTED_DIAG_KEY]
```

Redacted response summary:

```json
{
  "env": {
    "PAYAT_TOKEN_URL": "https://go.payat.co.za/yapi/oauth/token",
    "PAYAT_API_BASE": "https://go.payat.co.za/yapi/v1",
    "PAYAT_CLIENT_ID": "set:43chars",
    "PAYAT_CLIENT_SECRET": "set:36chars",
    "PAYAT_MERCHANT_IDENTIFIER": "set",
    "NEXT_PUBLIC_APP_URL": "https://app.plugapro.co.za"
  },
  "token": {
    "status": 200,
    "ok": true,
    "hasToken": true,
    "tokenLength": 740,
    "expiresIn": 3599,
    "scope": "not returned"
  },
  "rtp": {
    "endpoint": "https://go.payat.co.za/yapi/v1/integrator/rtp/create/single/[MERCHANT_IDENTIFIER_REDACTED]",
    "status": 403,
    "ok": false,
    "body": ""
  }
}
```

Interpretation:

This disproves the earlier broad hypothesis that the production failure is caused by missing runtime env vars or token acquisition failure. Production runtime config is present, and OAuth succeeds.

The failure boundary is now narrowed to the authorized RTP create call:

```text
POST /integrator/rtp/create/single/{merchantIdentifier}
-> HTTP 403 with empty body
```

The remaining supported causes are authorization/scope, credential mode mismatch, merchant identifier not authorized for this OAuth client, or merchant/account not enabled for Integrator RTP create.

### E-020: Local Variant Probe Rejected As Non-Equivalent

Source: local Node probe using `.vercel/.env.production.local`, with all secrets redacted.

Redacted result:

```text
Token URL: https://go.payat.co.za/yapi/oauth/token
API base: https://go.payat.co.za/yapi/v1
Client ID shape: set:43chars
Client secret shape: set:36chars
Merchant identifier shape: set:10chars

Variants tested:
- Basic auth, no scope
- Basic auth, scope=rtp:create:single
- form client_id/client_secret, scope=rtp:create:single
- Merchant endpoint variant was not reached because token failed

All local token requests returned:
HTTP 401
body: {"error":"invalid_client"}
```

Interpretation:

This local probe is not valid for proving the production PayAt failure because it contradicts the deployed runtime diagnostic, where the same logical token step succeeds with HTTP 200. Therefore, `.vercel/.env.production.local` is stale or not equivalent to the active production runtime. Further variant tests must run inside the deployed Vercel runtime or with freshly supplied credentials.

### E-021: Runtime Variant Diagnostic Deployment

Source: Vercel production deployment inspection.

Redacted evidence:

```text
Commit: ee6c404
Deployment URL: plug-a-gr6y79ovz-[team].vercel.app
Deployment id: dpl_CdYFtmWy1PhqK9udk4GRqre6yCyM
Target: production
Status: Ready
Aliases:
- https://app.plugapro.co.za
- https://admin.plugapro.co.za
```

Diagnostic route change:

```text
GET /api/debug/payat-ping?key=[REDACTED]&variants=1
```

The route now mirrors the production token-scope fix in its baseline request and adds:

- `basic_no_scope_integrator`: preserves the old failing control case for comparison.
- `basic_scope_integrator`: token request includes `scope=rtp:create:single`, then retries Integrator RTP create.
- `basic_scope_merchant_endpoint`: uses the scoped token against `POST /merchant/rtp/create/single`.

Interpretation:

The next user-run diagnostic can now disprove or support the remaining mode/scope hypotheses without changing production payment logic.

### E-022: Runtime Variant Diagnostic Result

Source: user-run production diagnostic with `variants=1`, after deployment `dpl_CdYFtmWy1PhqK9udk4GRqre6yCyM`.

Redacted response summary:

```json
{
  "token": {
    "status": 200,
    "ok": true,
    "scope": "(not returned)"
  },
  "rtp": {
    "endpoint": "https://go.payat.co.za/yapi/v1/integrator/rtp/create/single/[MERCHANT_IDENTIFIER_REDACTED]",
    "status": 403,
    "ok": false,
    "body": ""
  },
  "variants": [
    {
      "name": "basic_scope_integrator",
      "token": {
        "status": 200,
        "ok": true,
        "scope": "rtp:create:single"
      },
      "rtp": {
        "endpoint": "https://go.payat.co.za/yapi/v1/integrator/rtp/create/single/[MERCHANT_IDENTIFIER_REDACTED]",
        "status": 200,
        "ok": true,
        "body": "{\"requestToPayId\":326652,\"sourceReference\":\"[REDACTED]\",\"paymentLink\":\"https://payat.io/qr/[REDACTED]\"}"
      }
    },
    {
      "name": "basic_scope_merchant_endpoint",
      "token": {
        "status": 200,
        "ok": true,
        "scope": "rtp:create:single"
      },
      "rtp": {
        "endpoint": "https://go.payat.co.za/yapi/v1/merchant/rtp/create/single",
        "status": 200,
        "ok": true,
        "body": "{\"requestToPayId\":326653,\"sourceReference\":\"[REDACTED]\",\"paymentLink\":\"https://payat.io/qr/[REDACTED]\"}"
      }
    }
  ]
}
```

Interpretation:

This confirms the root cause for the provider-credit Pay@ failure:

```text
The legacy Pay@ OAuth token request omitted the required `scope=rtp:create:single`.
PayAt still returned an access token, but that unscoped token received HTTP 403 on RTP create.
When the same credentials requested `scope=rtp:create:single`, Integrator RTP create succeeded.
```

The Merchant endpoint also succeeded with a scoped token, but that does not require switching endpoint mode because the current Integrator endpoint also succeeds once scoped.

## Missing Evidence

- No current PayAt OAuth token response has been captured from the deployed app runtime.
- No current outbound PayAt RTP create response has been captured from the deployed app runtime.
- The local minimal isolated API request is blocked because production secrets are not available through the pulled env file.
- No full correlated application trace has been captured beyond route-level Vercel logs.

## Redaction Rules

- Authorization headers: show only `Bearer [redacted]` or `Basic [redacted]`.
- OAuth tokens: never print.
- Client secrets: never print.
- Merchant identifiers: mask unless already public and non-sensitive.
- Phone numbers: mask all but country code and last four digits.
- Emails: mask local part.
