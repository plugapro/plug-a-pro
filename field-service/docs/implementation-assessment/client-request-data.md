# Client Request — Data Capture and Privacy Upgrade

## G1 fix: safeForPreview enforcement

### Problem
The `Attachment` Prisma model has a `safeForPreview: Boolean @default(true)` field, but two query sites that return attachments for the customer token-page view (the public link the customer opens to view their own request) were not filtering on it. This meant attachments marked `safeForPreview: false` could appear in:

1. The HTML rendered by the token page (photo thumbnails)
2. The attachment API route when called with a valid ticket token, regardless of `safeForPreview`

An attacker who obtained a customer ticket token could construct a direct API call (`/api/attachments/{id}?token={ticket}`) for any attachment ID they knew about and receive the file, even if that attachment was marked private.

### Scope of fix

**Layer 1 — Query filter (prevents IDs reaching the HTML)**

`lib/job-request-access.ts:100` — `resolveJobRequestAccessToken` attachment include:
```diff
- where: { label: { in: ['customer_photo', 'evidence'] } },
+ where: { label: { in: ['customer_photo', 'evidence'] }, safeForPreview: true },
```

`lib/client-pwa-destination.ts:16` — `clientPwaRequestInclude` Prisma validator:
```diff
- where: { label: { in: ['customer_photo', 'evidence'] } },
+ where: { label: { in: ['customer_photo', 'evidence'] }, safeForPreview: true },
```

**Layer 2 — API-route enforcement (blocks direct fetch of safeForPreview=false IDs)**

`app/api/attachments/[id]/route.ts` — `tokenAllowsAttachment` calculation:
```diff
  const tokenAllowsAttachment =
    tokenScope?.status === 'active' &&
    attachmentJobRequestId != null &&
-   tokenScope.jobRequestId === attachmentJobRequestId
+   tokenScope.jobRequestId === attachmentJobRequestId &&
+   (isJobAttachment || attachment?.safeForPreview !== false)
```

Job attachments (work-evidence photos on a completed job) are exempt from this restriction because they are post-acceptance and always visible to the ticket holder.

### Files changed

| File | Change |
|---|---|
| `lib/job-request-access.ts` | Add `safeForPreview: true` to attachment where clause in `resolveJobRequestAccessToken` |
| `lib/client-pwa-destination.ts` | Add `safeForPreview: true` to attachment where clause in `clientPwaRequestInclude` |
| `app/api/attachments/[id]/route.ts` | Enforce `safeForPreview !== false` for ticket-token attachment serves (job attachments exempt) |

---

## G8 confirmation: Attachment API authorization

**Status: Already complete. No changes required.**

`app/api/attachments/[id]/route.ts` has complete layered authorization:

| Access path | Enforcement |
|---|---|
| Admin session | Always allowed |
| Provider session (job owner) | `job.providerId === provider.id` (DB PK, not Supabase UID) |
| Provider session (lead preview) | Active, non-expired lead for the same jobRequest; match not CANCELLED |
| Customer session | `jobRequest.customer.id === customer.id` or via job booking chain |
| Ticket token (customer access link) | `resolveJobRequestAccessScope` validates token + jobRequest ID match; safeForPreview enforced (new, G1 fix) |
| Provider lead token | `resolveProviderLeadAttachmentScope` validates token + jobRequest ID match |
| Unauthenticated, no token | 401 |
| Token mismatch | 403 with trace ID |
| Expired token | 401 |

Trace IDs are included in all denied responses via `X-Trace-Id` header and response body.

---

## G5 fix: displayCallOutFee and displayArrivalTime

**Status: Already implemented. No changes required.**

`lib/customer-shortlists.ts:generateCustomerShortlistForRequest` writes `displayCallOutFee` and `displayArrivalTime` to `ProviderShortlistItem` at creation time (lines 99–100):

```ts
displayCallOutFee: response.callOutFee,
displayArrivalTime: response.estimatedArrivalAt,
```

`getCustomerShortlistForRequest` reads them with a fallback to the live `ProviderOpportunityResponse` values:

```ts
callOutFee: decimalToNumber(item.displayCallOutFee ?? response?.callOutFee),
estimatedArrivalAt: item.displayArrivalTime ?? response?.estimatedArrivalAt ?? null,
```

G5 was not a real gap in the current codebase.

---

## Tests added

### `__tests__/lib/job-request-access.test.ts`

New describe block: `resolveJobRequestAccessToken — safeForPreview enforcement`

| Test | Assert |
|---|---|
| `requests only safeForPreview=true attachments in the token query` | Prisma `findUnique` call includes `where: { safeForPreview: true }` in attachment filter |
| `returns active status and includes only safeForPreview attachments` | Returned `jobRequest.attachments` never contains `safeForPreview: false` entries |

### `__tests__/api/attachments-authz.test.ts`

New describe block: `GET /api/attachments/[id] — safeForPreview enforcement with ticket tokens`

| Test | Assert |
|---|---|
| `allows a ticket-token request for a safeForPreview=true request attachment` | 200 |
| `blocks a ticket-token request for a safeForPreview=false request attachment (pre-acceptance)` | 403 |
| `allows a ticket-token request for a job attachment (work evidence) regardless of safeForPreview` | 200 — job attachments are post-acceptance and exempt |

---

## Test results

```
Test Files  165 passed (165)
Tests       1765 passed | 4 todo (1769)
Duration    10.68s
```

All 25 tests in the two touched test files pass.

---

## Remaining gaps (deferred)

| Gap | Description | Deferred reason |
|---|---|---|
| G2 | No shortlist in authenticated `/requests/[id]` detail page | Authenticated customer portal route; separate UI ticket |
| G3 | WhatsApp job-request flow does not capture `subcategory`, `maxCallOutFee`, `budgetPreference` | Requires schema fields + WhatsApp flow changes; separate step |
| G9 | `providerPreference` values differ between WhatsApp and PWA channels | Alignment work across multiple channel handlers; separate step |

---

## OpenBrain Note

Logged to OpenBrain under project `PlugAPro`, domain `engineering`, title `fix — G1 safeForPreview privacy enforcement (2026-05-07)`.
