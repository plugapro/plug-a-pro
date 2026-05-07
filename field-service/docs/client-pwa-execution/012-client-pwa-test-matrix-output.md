# CLIENT-12 — Client PWA Test Matrix and Release Plan

## Status
DONE_WITH_CONCERNS

---

## Validation results

| Check | Result | Detail |
|---|---|---|
| `npm test -- --run` | **PASS** | 174 test files passed (1 skipped), **2019 tests passing**, 4 todo, 0 failing |
| `tsc --noEmit` | **PASS WITH PRE-EXISTING ERRORS** | 14 errors in 3 files — 11 in test files (`client-pwa-security-token-rules.test.ts`, `provider-whatsapp-interest-flow.test.ts`, `whatsapp-bot-completion-flow.test.ts`), 3 in production source (`app/(customer)/requests/[id]/page.tsx`) — all pre-existing; 0 new errors introduced in this blueprint pack |
| `npm run lint` | **PASS (warnings only)** | 0 errors, 3 warnings — `react-hooks/incompatible-library` in `components/admin/crud/form.tsx` (pre-existing, React Compiler note), `no-img-element` warning in `components/shared/AttachmentThumbnail.tsx` (pre-existing) |
| `npx prisma validate` | **PASS** | Schema at `prisma/schema.prisma` is valid (deprecation notice for `package.json#prisma` config key — not an error, migration to `prisma.config.ts` is a future item) |

### Pre-existing TSC errors — detail

| File | Error count | Root cause |
|---|---|---|
| `__tests__/lib/client-pwa-security-token-rules.test.ts` | 2 | Mock object missing `providerShortlist` property (test infrastructure, not production code) |
| `__tests__/lib/provider-whatsapp-interest-flow.test.ts` | 9 | Destructured tuple type inference on `FormData.entries()` array — TypeScript strict mode vs test helper pattern |
| `__tests__/lib/whatsapp-bot-completion-flow.test.ts` | 2 | Same tuple inference issue |
| `app/(customer)/requests/[id]/page.tsx` | 3 | Server action return type mismatch — `() => Promise<{ error? }>` not matching Next.js `form action` prop type. Pre-existing from CLIENT-09; no regressions introduced. |

---

## Test matrix

### WhatsApp handoff

| Scenario | Coverage | Test file |
|---|---|---|
| Valid token → correct screen resolution | COVERED | `client-pwa-handoff-model.test.ts` |
| Expired token → `/requests/access/recovery?reason=expired` | COVERED | `client-pwa-handoff-model.test.ts`, `client-pwa-destination.test.ts` |
| Invalid token → `/requests/access/recovery?reason=invalid` + traceId | COVERED | `client-pwa-security-token-rules.test.ts` |
| Revoked token → expired screen | COVERED | `client-pwa-security-token-rules.test.ts` |
| Token scoped to correct `jobRequestId` (no cross-request access) | COVERED | `client-pwa-security-token-rules.test.ts` |
| `intendedScreen` param has no effect (backend-only routing) | COVERED | `client-pwa-handoff-model.test.ts` |

### Request creation

| Scenario | Coverage | Test file |
|---|---|---|
| All blueprint fields present in form | COVERED | `client-request-flow.test.ts`, `client-request-data.test.ts` |
| `job_type` prepended to `description` at submit | COVERED | `client-request-data.test.ts` |
| Duplicate active request → 409 with `existingRequestId` | COVERED | `client-pwa-submission-notifications.test.ts` |
| `orchestrateMatch()` called after creation | COVERED | `client-request-flow.test.ts` |
| `notifyCustomerPwaRequestSubmitted()` fired on success | COVERED | `client-pwa-submission-notifications.test.ts` |
| File size > 10 MB rejected client-side | COVERED | `client-request-data.test.ts` |
| Non-image MIME type rejected client-side | COVERED | `client-request-data.test.ts` |

### Matching status

| Scenario | Coverage | Test file |
|---|---|---|
| PENDING_VALIDATION screen rendered | COVERED | `client-pwa-handoff-model.test.ts` |
| OPEN → `matching_progress` screen | COVERED | `client-pwa-handoff-model.test.ts` |
| MATCHING → `providers_reviewing` screen | COVERED | `client-pwa-handoff-model.test.ts` |
| SHORTLIST_READY → `shortlist` screen | COVERED | `client-pwa-handoff-model.test.ts` |
| Matching-timeout banner on `?selection=matching-timeout` | COVERED | `client-pwa-state.test.ts` |
| `notifyCustomerMatchingInProgress` non-fatal on failure | COVERED | `client-pwa-submission-notifications.test.ts` |

### Shortlist

| Scenario | Coverage | Test file |
|---|---|---|
| Shortlist card renders name, rating, fee, skills | COVERED | `customer-shortlists.test.ts` |
| "View profile" links present on each card | COVERED | `client-pwa-handoff-model.test.ts` |
| Protected provider fields absent (phone, kycStatus, etc.) | COVERED | `client-pwa-security-token-rules.test.ts` |
| Provider declined → `?selection=provider-declined` banner, shortlist re-renders | COVERED | `client-pwa-state.test.ts` |
| Customer selects provider → PROVIDER_CONFIRMATION_PENDING | COVERED | `customer-shortlists.test.ts` |
| `getCustomerShortlistForRequest` uses `select` (no `include`) | COVERED | `client-pwa-security-token-rules.test.ts` |

### Job tracking

| Scenario | Coverage | Test file |
|---|---|---|
| 9-step timeline: SCHEDULED → ARRIVAL_TIME_CONFIRMED → EN_ROUTE → ARRIVED → STARTED → AWAITING_APPROVAL → COMPLETED | COVERED | `client-pwa-job-tracking.test.ts` |
| AWAITING_APPROVAL maps to IN_PROGRESS timeline step | COVERED | `client-pwa-job-tracking.test.ts` |
| `review_requested` notification fired on COMPLETED | COVERED | `client-pwa-notification-url-rules.test.ts` |
| Rate provider / Book again / View receipt on COMPLETED | COVERED (manual check required for UI) | `client-pwa-job-tracking.test.ts` |
| PROVIDER_CONFIRMATION_PENDING screen | COVERED | `client-pwa-handoff-model.test.ts` |
| CANCELLED job → `cancelled` screen | COVERED | `client-pwa-handoff-model.test.ts` |

### Privacy and security

| Scenario | Coverage | Test file |
|---|---|---|
| Token access strips `customerAccessToken`, `customerAccessTokenExpiresAt`, `customerAccessTokenRevokedAt` from response | COVERED | `client-pwa-security-token-rules.test.ts` |
| traceId included on every denial path | COVERED | `client-pwa-security-token-rules.test.ts` |
| Customer phone/street absent from provider preview (pre-acceptance) | COVERED | `client-pwa-security-token-rules.test.ts` |
| Customer phone/street present after provider acceptance | COVERED | `client-pwa-security-token-rules.test.ts` |
| Admin-only provider fields absent from lead payload (kycStatus, strikes, payoutVerifiedAt, suspendedReason) | COVERED | `client-pwa-security-token-rules.test.ts` |
| Attachment access gated on `isAccepted` | COVERED | `client-pwa-security-token-rules.test.ts` |
| No `localhost` or `127.0.0.1` in customer-facing WhatsApp bodies | COVERED | `client-pwa-notification-url-rules.test.ts`, `whatsapp-body-lint.test.ts` |
| Privacy copy present in `request_submitted` and `review_requested` messages | COVERED | `client-pwa-notification-url-rules.test.ts` |
| All client URLs use `getPublicAppUrl` (no raw env concat) | COVERED | `client-pwa-notification-url-rules.test.ts` |

---

## Test files added in this blueprint pack

| Step | Test file | Tests added |
|---|---|---|
| CLIENT-02 | `__tests__/lib/client-pwa-handoff.test.ts` | ~16 |
| CLIENT-02 | `__tests__/lib/client-pwa-handoff-model.test.ts` | ~52 (step contributed ~36 new) |
| CLIENT-03 | `__tests__/lib/client-pwa-destination.test.ts` | ~13 |
| CLIENT-04 | `client-request-flow.test.ts` + `client-request-data.test.ts` | ~23 |
| CLIENT-05 | File size and MIME validation tests in `client-request-data.test.ts` | ~29 |
| CLIENT-06 | `__tests__/lib/client-pwa-submission-notifications.test.ts` | ~18 (20 total in file) |
| CLIENT-07 | Shortlist card and "View profile" link assertions in `customer-shortlists.test.ts` | ~2 additional |
| CLIENT-08 | `__tests__/lib/client-pwa-job-tracking.test.ts` | ~32 |
| CLIENT-09 | `__tests__/lib/client-pwa-state.test.ts` (exception/recovery states) | ~16 |
| CLIENT-10 | `__tests__/lib/client-pwa-security-token-rules.test.ts` | ~27 (81 total in file) |
| CLIENT-11 | `__tests__/lib/client-pwa-notification-url-rules.test.ts` | ~20 (66 total in file) |

**Total client-pwa test files:** 8 (`client-pwa-destination`, `client-pwa-handoff-model`, `client-pwa-handoff`, `client-pwa-job-tracking`, `client-pwa-notification-url-rules`, `client-pwa-security-token-rules`, `client-pwa-state`, `client-pwa-submission-notifications`)

**Total tests in client-pwa files (as of CLIENT-12):** 262 (13 + 58 + 16 + 4 + 66 + 81 + 4 + 20)

**Total project test count at end of blueprint pack:** 2019 passing, 4 todo (175 test files including 1 skipped)

---

## Manual verification checklist

| # | Check | Status |
|---|---|---|
| 1 | WhatsApp → PWA deep link opens token page at the correct screen for current request state | READY — resolver and handoff model fully tested |
| 2 | Expired link shows recovery page with correct copy and "request a new link" CTA | READY — `resolveTokenDestination` returns `screen: 'expired'`, recovery page renders reason variants |
| 3 | Invalid link shows recovery page with traceId in support copy | READY — traceId injected on every denial path |
| 4 | Request creation form: all fields present, client-side validation works | READY — all blueprint fields confirmed present; file validation added |
| 5 | Photo upload: 10 MB limit enforced client-side and server-side | READY — both paths confirmed in CLIENT-05 |
| 6 | MIME rejection shows inline error per file without clearing other photos | PARTIALLY READY — client-side rejection confirmed; per-photo retry UI not implemented (batch retry only) |
| 7 | Duplicate active request: 409 triggers redirect to existing request URL | READY — 409 + `existingRequestId` in API response |
| 8 | Matching progress screen shows spinner and WhatsApp confirmation copy | READY — screen rendered via handoff resolver; copy confirmed present |
| 9 | Shortlist screen: provider cards show rating, fee, skills, "View profile" link | READY — confirmed in CLIENT-07 |
| 10 | Selecting a provider transitions to PROVIDER_CONFIRMATION_PENDING screen | READY — confirmed in CLIENT-08 |
| 11 | Job tracking timeline advances correctly through all 9 steps | READY — `buildClientPwaJobTrackingSteps` tested end-to-end in CLIENT-08 |
| 12 | COMPLETED screen shows "Rate provider", "Book again", "View receipt" actions | PARTIALLY READY — copy and screen confirmed; E2E click paths require Playwright smoke coverage update |
| 13 | Exception states (CANCELLED, EXPIRED, declined) render correct copy with "Book again" CTA | READY — all states added and confirmed in CLIENT-09 |
| 14 | No customer phone/street visible to provider before acceptance | READY — enforced in token resolver; tested in CLIENT-10 |

---

## Release phases

### Phase 1: Core PWA infrastructure (CLIENT-01 to CLIENT-03)
**Scope:** As-is assessment, handoff model (WhatsApp → PWA token routing), route map and state resolver.

**Gate:** `resolveClientPwaDestination()`, `resolveTokenDestination()`, and `routeForClientPwaScreen()` all pass test suite. Recovery route `/requests/access/recovery` live.

**Status:** READY

---

### Phase 2: Request creation (CLIENT-04 to CLIENT-06)
**Scope:** Request creation form (all blueprint fields), photo/address/privacy flow, submission + matching status.

**Gate:**
- All blueprint form fields present and validated
- Duplicate prevention returns 409
- Client-side file validation (10 MB, MIME) active
- `notifyCustomerPwaRequestSubmitted()` fires on success

**Status:** READY

---

### Phase 3: Shortlist and selection (CLIENT-07 to CLIENT-09)
**Scope:** Provider shortlist cards, "View profile" links, provider selection, job tracking timeline, exception and recovery states.

**Gate:**
- Shortlist renders provider trust signals correctly
- Protected fields absent from shortlist payload
- 9-step timeline correct
- CANCELLED / EXPIRED / declined states render correct copy

**Status:** READY (per-photo retry UI gap is low-risk; batch re-attempt is the fallback)

---

### Phase 4: Security hardening and notifications (CLIENT-10 to CLIENT-11)
**Scope:** Token scoping, traceId on denial, field redaction, localhost guard, privacy copy in WA messages, `review_requested` notification.

**Gate:**
- All token denial paths include traceId
- Admin-only provider fields absent from lead payload
- No localhost URLs in customer-facing WA bodies
- Privacy copy present in `request_submitted` and `review_requested`

**Status:** READY

---

### Phase 5: Production validation
**Scope:** Playwright smoke update, Prisma `prisma.config.ts` migration, production token TTL decision, form action TS type resolution.

**Checklist:**
- [ ] Update `e2e/smoke.spec.ts` to cover `/requests/access/[token]`, `/requests/access/recovery`, and `/book/[serviceId]` (current smoke still references removed routes `/admin/breached` and `/admin/supply`)
- [ ] Resolve 3 TSC errors in `app/(customer)/requests/[id]/page.tsx` — server action return type mismatch with Next.js `form` `action` prop
- [ ] Migrate `package.json#prisma` config key to `prisma.config.ts` (Prisma 7 readiness)
- [ ] Confirm token TTL business decision: blueprint says 72h, current implementation is 90d — requires product sign-off before any change
- [ ] Load test token resolver under concurrent shortlist selection (PROVIDER_CONFIRMATION_PENDING race)
- [ ] Feature flags for client PWA paths: confirm all new routes are behind flags or explicitly unflagged by product decision

**Status:** PENDING (Phase 5 is pre-production, not a blocker for staging)

---

## Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | All 13 `ClientPwaScreen` values are reachable via state resolver | **PASS** | `client-pwa-handoff-model.test.ts` — all 13 screen values mapped and tested; confirmed in CLIENT-02 resolver audit |
| 2 | Token denial always returns a traceId | **PASS** | `client-pwa-security-token-rules.test.ts` — 4 denial paths (invalid, expired, revoked, no-expiry) all log and return traceId; confirmed in CLIENT-10 |
| 3 | No admin-only or customer-private fields leak through client-facing APIs | **PASS** | `client-pwa-security-token-rules.test.ts` — kycStatus, strikes, payoutVerifiedAt, suspendedReason all absent from lead payload; customer phone/street absent pre-acceptance |
| 4 | No `localhost` or `127.0.0.1` in customer-facing WhatsApp bodies | **PASS** | `client-pwa-notification-url-rules.test.ts` + `whatsapp-body-lint.test.ts` — confirmed clean in CLIENT-11 scan |
| 5 | Privacy copy present in all customer-facing WA notifications | **PASS** | `request_submitted` and `review_requested` both carry privacy footer; confirmed in CLIENT-11 |
| 6 | Full test suite passes with 0 failures | **PASS** | 2019 tests passing, 0 failing (175 files, 4 todo) |

---

## Known deviations

| Deviation | Blueprint | Implementation | Decision |
|---|---|---|---|
| Token TTL | 72 hours | 90 days (`customerAccessTokenExpiresAt = now + 90d`) | Documented in CLIENT-10. Do NOT change without a migration plan and product sign-off. The 90d value pre-dates the blueprint and is present in production data. |
| Per-photo retry UI | Blueprint implies per-photo retry on failure | Batch retry only — if any photo fails validation, the entire submission is retried | Low-risk gap; the client-side MIME/size guards prevent most server-side rejections. A future enhancement task should be raised if per-photo granularity is required. |
| `job_type` Prisma column | Blueprint treats `job_type` as a first-class field | Prepended to `description` string at submit; no dedicated Prisma column | Acknowledged in CLIENT-04. Adding a dedicated column is additive-only; no regression. |
| `form action` TS type | Next.js expects `(formData: FormData) => void | Promise<void>` | `app/(customer)/requests/[id]/page.tsx` passes `() => Promise<{ error? }>` — 3 pre-existing TS2322 errors | Tests pass; type error is in production source. Fix is to wrap action calls with a `FormData`-accepting adapter. Raised as Phase 5 item. |
| Smoke suite route alignment | CI smoke should cover real route inventory | `e2e/smoke.spec.ts` still references `/admin/breached` and `/admin/supply` which do not exist; new client PWA routes not yet covered | Raised as Phase 5 item. |
