# PayAt Swagger Contract Checklist

Last updated: 2026-05-23 16:00 SAST

Status values: `matches`, `mismatch`, `missing`, `unclear`, `not applicable`.

## Swagger Sources

- Swagger UI: `https://go.payat.co.za/yapi/swagger-ui/index.html`
- Swagger config: `https://go.payat.co.za/yapi/v3/api-docs/swagger-config`
- Integrator OpenAPI: `https://go.payat.co.za/yapi/v3/api-docs/integrator`
- Merchant OpenAPI: `https://go.payat.co.za/yapi/v3/api-docs/merchant`
- Ecommerce OpenAPI: `https://go.payat.co.za/yapi/v3/api-docs/ecommerce`

## Extracted Contract Summary

- Server URL for integrator, merchant, and ecommerce APIs: `https://go.payat.co.za/yapi/v1`.
- OAuth token URL for all three API groups: `https://go.payat.co.za/yapi/oauth/token`.
- OAuth flow: client credentials.
- API calls require `Authorization: Bearer <access_token>`.
- Standard RTP integrator scopes: `rtp:create:single`, `rtp:read`, `rtp:cancel:single`.
- Ecommerce RTP scopes: `ecommerce:rtp:create:single`, `ecommerce:rtp:cancel:single`, `ecommerce:generatecredentials`.
- Standard integrator RTP create endpoint: `POST /integrator/rtp/create/single/{merchantIdentifier}`.
- Standard merchant RTP create endpoint: `POST /merchant/rtp/create/single`.
- Ecommerce RTP create endpoint: `POST /integrator/ecommerce/rtp/create/single/{merchantIdentifier}`.
- Monetary amounts are integer South African cents.
- `clientAccountNumber` is a numeric string matching `^\d{1,14}$`; docs describe it as a unique 14-digit number and auto-generate if omitted.
- Standard RTP required create fields: `amount`, `clientReferenceNumber`, `customerNameSurname`.
- Optional standard RTP fields include `clientAccountNumber`, `description`, `customerMobileNumber`, `customerEmail`, `customerVatNumber`, `daysValid`, `lineItems`, `minimumAmount`, `maximumAmount`, `multiPremium`, `merchantDisplayName`, `notificationNumber`.
- Mobile fields must match `^(\+27|27|0)?[6-8][0-9]{8}$`.
- Create success response status is `201` with `requestToPayId`, `sourceReference`, and optional `paymentLink`.
- Read success response status is `200`; current state is returned as `accountState`.
- Cancel uses `PUT /integrator/rtp/cancel/single/{merchantIdentifier}/{clientAccountNumber}` and only `PAYMENT_OUTSTANDING` RTPs can be cancelled.
- Webhook test endpoint exists at `POST /integrator/payment-notification/webhook/test`.
- Payment notification webhook payload has `accountNumber`, `referenceNumber`, `settlementBatchId`, `description`, `customer`, `businessName`, `merchantIdentifier`, `businessContactNumber`, and `amountPaid`.
- Webhook auth options in Swagger test contract are `NO_AUTH`, `BASIC`, `OAUTH2`, and `API_KEY`.

## Checklist

| Contract Item | Swagger Requirement | Current Implementation | Status | Evidence |
|---|---|---|---|---|
| Base URL | `https://go.payat.co.za/yapi/v1` | Legacy uses `PAYAT_API_BASE`; PayAtGo uses `PAYAT_GO_BASE_URL` | unclear | Production env pull does not expose base values; runtime diagnostic needed. |
| OAuth token URL | `https://go.payat.co.za/yapi/oauth/token` | Legacy reads `PAYAT_TOKEN_URL`; PayAtGo derives `../oauth/token` from base URL | matches | Production env pull shows legacy `PAYAT_TOKEN_URL` matches Swagger; PayAtGo derivation also matches. |
| Token auth format | OAuth2 client credentials | Legacy sends Basic auth plus grant type; PayAtGo sends `client_id`, `client_secret`, `grant_type`, `scope` in form body | unclear | OpenAPI states flow, not exact token request transport beyond OAuth2. Controlled token tests required. |
| Scope strings | Integrator/merchant RTP: `rtp:create:single rtp:read rtp:cancel:single` | PayAtGo reads `PAYAT_GO_SCOPES`; legacy token request sends no explicit scope | unclear | Need controlled token tests. |
| Standard integrator create endpoint | `POST /integrator/rtp/create/single/{merchantIdentifier}` | Legacy and PayAtGo use this endpoint for standard RTP | matches | E-001, E-004, Swagger integrator doc. |
| Merchant create endpoint | `POST /merchant/rtp/create/single` | Not used by current code | not applicable | Current mode appears integrator. |
| Ecommerce create endpoint | `POST /integrator/ecommerce/rtp/create/single/{merchantIdentifier}` | Not used by current code | not applicable | Current provider top-up/booking RTP is not ecommerce redirect flow. |
| Standard create required fields | `amount`, `clientReferenceNumber`, `customerNameSurname` | Both clients send these fields | matches | Source inspection and Swagger schema. |
| Optional create fields | Includes `clientAccountNumber`, `description`, mobile/email, `daysValid`, min/max amount, display name, notification number | Clients send a subset plus `minimumAmount`/`maximumAmount` | matches | Swagger schema allows optional fields. |
| Amount format | Integer cents | Current clients send integer cents | matches | Swagger monetary values section and client code. |
| Currency field | Not listed on RTP create schema | Current clients do not send currency | matches | Internal currency validation remains app-side. |
| Customer mobile format | SA mobile pattern accepts `+27`, `27`, `0`, or local 9-digit formats | PayAtGo normalizes to E.164; legacy passes provider phone as stored/resolved | PayAtGo matches; legacy unclear | Need actual provider phone format in app trace. |
| `clientAccountNumber` format | Numeric string `^\d{1,14}$`, described as unique 14-digit | Both clients generate 14-digit numeric strings | matches | Source inspection and Swagger schema. |
| Create success response | HTTP 201 with `requestToPayId`, `sourceReference`, optional `paymentLink` | Legacy requires `paymentLink`; PayAtGo accepts null | legacy mismatch | Standard response requires `requestToPayId` and `sourceReference`, not `paymentLink`. |
| Read endpoint | `GET /integrator/rtp/read/{merchantIdentifier}/{clientAccountNumber}` | PayAtGo uses this endpoint | matches | Source inspection and Swagger path. |
| Cancel endpoint | `PUT /integrator/rtp/cancel/single/{merchantIdentifier}/{clientAccountNumber}` | PayAtGo uses this endpoint | matches | Source inspection and Swagger path. |
| Status enum values | `PAYMENT_OUTSTANDING`, `PROCESSING_PAYMENT`, `PAYMENT_COMPLETED`, `PARTIAL_PAYMENT_RECEIVED`, `PAYMENT_FEES_ISSUE`, `PAYMENT_READY_FOR_SETTLEMENT`, `SETTLEMENT_PROCESSED`, `PAYMENT_CANCELLED`, `PAYMENT_EXPIRED`, `CANCELLED_DUE_TO_PRICING_PACKAGE_UPDATE` | `lib/payat-go/status.ts` maps all listed values | matches | Source inspection and Swagger enum. |
| Webhook payload | Payment notification payload uses `accountNumber`, `referenceNumber`, `amountPaid`, etc. | PayAtGo callback extracts `accountNumber`; legacy webhook expects `status`, `amount`, `reference` aliases | PayAtGo partial match; legacy mismatch/unclear | Legacy handler likely not aligned to integrator webhook payload. |
| Webhook auth | Test contract supports `NO_AUTH`, `BASIC`, `OAUTH2`, `API_KEY` | PayAtGo callback uses custom header secret compatible with API key style; legacy uses HMAC `x-payat-signature` | PayAtGo likely matches if portal configured API key; legacy unclear | Need portal config or webhook test endpoint. |
