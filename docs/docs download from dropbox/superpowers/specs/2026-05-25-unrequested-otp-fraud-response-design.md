# Unrequested OTP Fraud Response — Design Spec

- **Project:** Plug A Pro (`field-service/`)
- **Date:** 2026-05-25
- **Status:** Approved design → ready for implementation plan
- **Feature flags:** `security.otp.report` (capability), `admin.security.otp` (admin console mutations)

---

## 1. Problem & goal

Plug A Pro sends OTPs over WhatsApp for login/signup. When a user receives an OTP
they did not request, we want a one-tap way for them to report it, and for the
system to immediately neutralise the attempt, protect the account, raise an
auditable security event, and notify the user calmly.

**Primary goal:** reporting an unrequested OTP invalidates that OTP, invalidates
sibling OTPs for the same phone, raises a `SecurityEvent`, applies a temporary
lock + mandatory step-up, revokes existing sessions where possible, and sends a
calm WhatsApp confirmation — all without ever storing or logging the raw code,
asking the user to return the code, or leaking whether an account exists.

---

## 2. Architectural reality (do not fight it)

**Supabase Auth owns OTP generation, storage, and verification.** Plug A Pro
never generates or verifies the code itself. The app only:

- **Sees the code in exactly one server location:** the Supabase Auth send-sms
  hook `field-service/app/api/auth/hooks/send-sms/route.ts`, which receives
  `sms.otp`, `sms.phone`, `user.id`, then calls `deliverOtp()` to send it over
  WhatsApp (`field-service/lib/otp-delivery.ts`).
- **Issues the real app session cookie (`sb-access-token`) after Supabase
  verifies**, at two distinct call sites (see §4).

Therefore this feature is a **shadow fraud-response layer** wrapped around
Supabase's OTP, not a replacement OTP engine.

### What we can and cannot do (precise wording)

- We **can** prevent *future* OTP delivery for a locked phone (refuse in the
  send-sms hook — the strong gate; the user never receives a usable code).
- We **can** withhold our own `sb-access-token` session cookie for a
  locked / step-up phone (session gate, §4).
- We **can** revoke a known Supabase JWT/session when the request path has one.
  The installed `@supabase/auth-js` admin `signOut()` requires a valid JWT; it
  is **not** a global "sign out by `userId`" primitive.
- We **cannot** retroactively force Supabase to reject an OTP that was already
  delivered *before* the report. That window is closed by delivery refusal +
  known-session revocation + withholding our cookie — **not** by intercepting
  verify.

### Rejected alternative

App-owned OTP issuer/verifier (store `code_hash`, verify ourselves). Rejected:
creates two competing auth authorities, risks drift with Supabase, far beyond an
MVP. We store `codeHash` only to bind a *report* to a real challenge — never to
authenticate a login.

---

## 3. Data model (additive only — house rule #2)

New Prisma models in `field-service/prisma/schema.prisma`, mirroring repo
conventions: PascalCase models with `@@map` snake_case tables, camelCase fields,
`@id @default(cuid())`, `@default(now())` / `@updatedAt`, `Json` for metadata,
UPPER_SNAKE enums. `userId` is the **Supabase auth user id** (string, no FK —
matches existing `OtpDeliveryAttempt`). Raw OTP is never stored.

### 3.1 `OtpChallenge` → `otp_challenges`

Tracking record, distinct from the existing `OtpDeliveryAttempt` (which stays
delivery-wire telemetry).

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `userId` | `String?` | Supabase auth id; nullable (phone may not map to a user) |
| `phoneE164` | `String` | normalized E.164 |
| `purpose` | `OtpPurpose` | only LOGIN/SIGNUP wired now |
| `codeHash` | `String?` | `HMAC-SHA256(pepper, code)`; bind report→challenge only |
| `status` | `OtpChallengeStatus @default(REQUESTED)` | |
| `expiresAt` | `DateTime` | from `OTP_EXPIRY_MINUTES` |
| `verifiedAt` | `DateTime?` | |
| `reportedAt` | `DateTime?` | |
| `attemptCount` | `Int @default(0)` | |
| `provider` | `String @default("WHATSAPP")` | delivery provider |
| `providerMessageId` | `String?` | WhatsApp wamid; nullable (provider may not return it) |
| `requestedIpHash` | `String?` | `sha256(pepper, ip)` |
| `requestedUserAgentHash` | `String?` | `sha256(pepper, ua)` |
| `requestContext` | `Json @default("{}")` | non-PII context (traceId, hookRequestId) |
| `reportTokenHash` | `String?` | `sha256(token)`; single-use binding |
| `reportTokenUsedAt` | `DateTime?` | single-use marker |
| `createdAt` / `updatedAt` | `DateTime` | |

Indexes: `[phoneE164, status]`, `[phoneE164, createdAt]`, `[status, createdAt]`,
`[userId]`. Relation: `securityEvents SecurityEvent[]`.

### 3.2 `SecurityEvent` → `security_events`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `userId` | `String?` | |
| `phoneE164` | `String` | |
| `eventType` | `SecurityEventType` | |
| `severity` | `SecuritySeverity` | |
| `status` | `SecurityEventStatus @default(NEW)` | |
| `relatedOtpChallengeId` | `String?` | |
| `sourceChannel` | `SecuritySourceChannel` | |
| `metadata` | `Json @default("{}")` | masked summary only |
| `createdAt` / `updatedAt` | `DateTime` | |
| `resolvedAt` | `DateTime?` | |
| `resolvedByUserId` | `String?` | |

Relation: `relatedOtpChallenge OtpChallenge? @relation(fields:
[relatedOtpChallengeId], references: [id], onDelete: SetNull)`.
Indexes: `[status, createdAt]`, `[phoneE164, createdAt]`, `[eventType, createdAt]`.

### 3.3 `AccountSecurityState` → `account_security_states`

Phone-keyed so it works when the user is unknown.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `phoneE164` | `String @unique` | |
| `userId` | `String?` | |
| `lockedUntil` | `DateTime?` | hard lock window |
| `lockReason` | `String?` | |
| `stepUpRequired` | `Boolean @default(false)` | applies only after lock clears |
| `stepUpSetAt` | `DateTime?` | |
| `lastReportedAt` | `DateTime?` | |
| `reportCount` | `Int @default(0)` | |
| `createdAt` / `updatedAt` | `DateTime` | |

Index: `[lockedUntil]`.

### 3.4 Enums

- `OtpPurpose`: `LOGIN, SIGNUP, BOOKING_CONFIRMATION, PAYMENT_CONFIRMATION, TECHNICIAN_ACCESS, PROFILE_CHANGE` (only LOGIN/SIGNUP wired now; rest reserved).
- `OtpChallengeStatus`: `REQUESTED, SENT, VERIFIED, EXPIRED, CANCELLED, REPORTED_UNREQUESTED, FAILED`.
- `SecurityEventType`: `OTP_REPORTED_UNREQUESTED, OTP_RATE_LIMIT_EXCEEDED, OTP_VERIFICATION_FAILED_REPEATEDLY, OTP_DELIVERY_REFUSED_DURING_LOCK, ACCOUNT_LOCKED, STEP_UP_COMPLETED, LOCK_CLEARED_BY_ADMIN`.
- `SecuritySeverity`: `LOW, MEDIUM, HIGH, CRITICAL`.
- `SecurityEventStatus`: `NEW, ACKNOWLEDGED, RESOLVED, FALSE_POSITIVE`.
- `SecuritySourceChannel`: `WHATSAPP_BUTTON, PWA_LINK, ADMIN, SYSTEM`.

### 3.5 RLS + metadata allowlists

All three new public tables must have RLS enabled in the same migration that
creates them. This follows Supabase's exposed-schema guidance: tables in
`public` must have RLS enabled, and without policies they are inaccessible to
anon/publishable-key API clients.

```sql
ALTER TABLE "public"."otp_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."account_security_states" ENABLE ROW LEVEL SECURITY;
```

Do **not** add anon/authenticated policies for this MVP. The app server uses the
existing Prisma service-role connection, which bypasses RLS; exposed Data API
access stays deny-by-default. Keep the existing RLS migration-coverage test
green so future public tables cannot ship without RLS coverage.

JSON fields are allowlisted before persistence:
- `OtpChallenge.requestContext`: `traceId`, `hookRequestId`, `source`,
  `sourceRoute`, `deliveryRefusedReason`, `challengeVerification`.
- `SecurityEvent.metadata`: `traceId`, `reason`, `windowStart`, `windowEnd`,
  `count`, `source`, `sourceRoute`, `relatedStatus`, `userIdPresent`.

Implement these with typed Zod schemas (or the repo's equivalent validation
helper) and strip unknown keys. Never persist names, emails, raw phone
substrings, raw IPs, user-agent strings, OTPs, access tokens, or provider
response bodies in either JSON field.

---

## 4. Session enforcement — shared gate (correction #1)

There is **no single session chokepoint today**:

- **Customer** login verifies client-side, then POSTs to `/api/auth/session`
  which sets the cookie (`field-service/app/(auth)/verify/page.tsx:116`,
  `field-service/app/api/auth/session/route.ts:114-115`).
- **Provider** login verifies server-side and sets the cookie **directly**
  (`field-service/app/api/auth/provider/verify-code/route.ts:106,225`),
  bypassing `/api/auth/session`.

**Fix:** introduce `field-service/lib/auth-session-gate.ts`:

```ts
issueAuthSessionWithSecurityGate({
  accessToken, phoneE164, userId, maxAge, sourceRoute,
}): Promise<
  | { ok: true; setCookie: string }
  | { ok: false; reason: 'LOCKED' }
  | { ok: false; reason: 'STEP_UP_REQUIRED'; pendingStepUpCookie: string }
>
```

It reads `AccountSecurityState`, and:
- if the security-state lookup throws, times out, or the database is
  unavailable → `{ ok: false, reason: 'LOCKED' }`, with response metadata
  `security_gate_unavailable`; audit the failure and withhold every session
  cookie (fail-closed).
- if `lockedUntil > now` → `{ ok: false, reason: 'LOCKED' }` (no cookie).
- else if `stepUpRequired` → no full cookie; return
  `{ ok: false, reason: 'STEP_UP_REQUIRED', pendingStepUpCookie }` and the
  caller redirects / responds to the checkpoint UI.
- else → mark the latest eligible `OtpChallenge` `VERIFIED`, then return the
  `sb-access-token` `Set-Cookie`.

Challenge verification update is explicit:
- update the latest active challenge where `phoneE164` matches,
  `userId` matches when the helper receives one, `status in (REQUESTED, SENT)`,
  and `expiresAt > now`, ordered by `createdAt desc`.
- if no challenge is found, login/session issuance continues according to the
  lock / step-up state. Record audit metadata
  `{ challengeVerification: "not_found", userIdPresent: Boolean(userId), sourceRoute }`;
  never fail login only because a shadow tracking record is absent.

Pending step-up cookie contract:
- name: `pap-step-up-token`.
- attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=600`; append `Secure`
  in production, mirroring `field-service/lib/auth-session-cookie.ts`.
- plaintext payload before encryption:
  `{ accessToken, userId, phoneE164, maxAge, sourceRoute, expiresAt }`.
- encryption: JSON payload encrypted with AES-256-GCM. Derive the 32-byte key
  from `STEP_UP_COOKIE_KEY` when present (base64url/base64 32-byte raw key).
  If unset, derive from `OTP_HASH_PEPPER` using HKDF-SHA256 with salt
  `pap-step-up-token:v1` and info `plug-a-pro/security-step-up`. Production
  should prefer the dedicated key; local/dev may use the pepper-derived
  fallback.
- token encoding: `base64url(iv).base64url(ciphertext).base64url(authTag)`,
  with a fresh 12-byte IV per cookie.
- `sourceRoute` records the route that originally verified the OTP
  (`/api/auth/session` or `/api/auth/provider/verify-code`) so the ack endpoint
  can reissue `sb-access-token` with the same cookie shape and route-specific
  audit context.

**Both** `POST /api/auth/session` and provider `verify-code` call this helper
instead of building the cookie inline. Single enforcement path, two call sites.

---

## 5. Core service + crypto (single source of truth — spec §6)

### 5.1 `field-service/lib/otp-security.ts`

All fraud logic lives here (no duplication between webhook and PWA paths):

- `recordOtpChallenge({ phoneE164, userId, purpose, code, ip, ua, context })`
  → creates challenge `REQUESTED`, stores `codeHash`, mints report token,
  returns `{ challengeId, reportToken }`.
- `markChallengeSent(challengeId, providerMessageId | null)` → `SENT`
  (handles missing message id).
- `markChallengeSendFailed(challengeId)` → `FAILED`.
- `getAccountSecurityState(phoneE164)` / `isDeliveryAllowed(phoneE164)`.
- `recordDeliveryRefusedDuringLock({ phoneE164, userId, challengeId, ip, ua })`
  → creates / dedupes
  `SecurityEvent(OTP_DELIVERY_REFUSED_DURING_LOCK, LOW)` at most once per phone
  per `OTP_LOCK_REFUSAL_EVENT_WINDOW_MINUTES` (default `15`), then audits the
  refusal. This keeps repeated post-lock login attempts visible in
  `/admin/otp-security` without flooding operators.
- `reportUnrequestedOtp({ token?, challengeId?, sourceChannel, ip?, ua? })`
  — **idempotent**; the one entry point for webhook + PWA. Steps:
  1. validate token (tamper / expiry / single-use) → resolve challenge.
  2. if already reported → return generic success (idempotent; multi-tap, retries).
  3. challenge → `REPORTED_UNREQUESTED`, set `reportedAt`, `reportTokenUsedAt`.
  4. invalidate sibling active challenges for the phone (`REQUESTED`/`SENT` → `CANCELLED`).
  5. create `SecurityEvent(OTP_REPORTED_UNREQUESTED, HIGH)`.
  6. `applyLockAndStepUp(phoneE164, userId)`.
  7. revoke known Supabase JWT/session when available (best-effort); do not
     promise global session revocation by `userId`.
  8. send calm WhatsApp confirmation (channel-aware — §8).
  9. audit `security.otp.reported` + `security.account.locked`.
- `applyLockAndStepUp(phoneE164, userId)` → set `lockedUntil = now +
  OTP_LOCK_MINUTES…`, `stepUpRequired = true`, bump `reportCount`,
  `lastReportedAt`.
- `recordVerificationResult({ phoneE164, userId, success, source })` →
  increments `attemptCount`; after `OTP_MAX_VERIFY_ATTEMPTS` raises
  `SecurityEvent(OTP_VERIFICATION_FAILED_REPEATEDLY, MEDIUM)`. Client telemetry
  calls pass `source: "client_telemetry"` and are never allowed to create
  `HIGH` / `CRITICAL` events by themselves.
- `checkOtpVerifyLimit({ phoneE164, ip, ua })` → route-level guard for
  `POST /api/security/otp/verify-failed`; it rate-limits telemetry and only
  permits counting when a recent active challenge exists for that phone
  (`status in (REQUESTED, SENT)`, `expiresAt > now`).
- `clearLock(phoneE164, { byAdminId })` → clears lock (+ optionally step-up);
  audited; raises `LOCK_CLEARED_BY_ADMIN`.
- `completeStepUp(phoneE164, userId)` → clears `stepUpRequired`; raises
  `STEP_UP_COMPLETED`.
- `maybeAlertAdmins(phoneE164)` → if HIGH/CRITICAL events for phone within window
  ≥ `SECURITY_EVENTS_ADMIN_ALERT_THRESHOLD`, send admin alert via existing
  `sendAdminEscalation`.

### 5.2 `field-service/lib/otp-security-crypto.ts` (mirrors `webhook-auth.ts`)

- `hashOtpCode(code)` = `HMAC-SHA256(OTP_HASH_PEPPER, normalize(code))` → hex.
  **Raw code never stored/logged** — enforced with the same banner comment style
  already on `OtpDeliveryAttempt`.
- Report token: `base64url(challengeId + "." + expEpoch) + "." + sig`, where
  `sig = HMAC-SHA256(pepper, challengeId + "|" + expEpoch)`.
  - Contains **no** raw OTP and no PII.
  - Verified timing-safe (`crypto.timingSafeEqual`).
  - Bound to challenge via `challengeId`.
  - Single-use via `reportTokenHash` (`sha256(token)`) + `reportTokenUsedAt`.
  - Expiry via `expEpoch`.
- `hashContext(value)` = `sha256(pepper + value)` for IP/UA (privacy-preserving).

### 5.3 `field-service/lib/otp-security-config.ts`

Reads + validates env (fail-closed in production if `OTP_HASH_PEPPER` missing):

| Env | Default | Use |
|---|---|---|
| `OTP_EXPIRY_MINUTES` | `10` | challenge `expiresAt` (report window / tracking) |
| `OTP_MAX_VERIFY_ATTEMPTS` | `5` | repeated-failure threshold |
| `OTP_LOCK_MINUTES_AFTER_UNREQUESTED_REPORT` | `60` | hard lock window |
| `OTP_HASH_PEPPER` | **required** | code/token/context HMAC secret |
| `STEP_UP_COOKIE_KEY` | optional | dedicated 32-byte key for pending cookie encryption |
| `SECURITY_EVENTS_ADMIN_ALERT_THRESHOLD` | `3` | admin alert trigger |
| `OTP_LOCK_REFUSAL_EVENT_WINDOW_MINUTES` | `15` | lock-refusal event dedupe window |
| `OTP_CHALLENGE_RETENTION_DAYS` | `30` | retention for terminal challenge telemetry |

Per-phone / per-IP **request** limits **reuse the existing limiters**
`OTP_SEND_LIMIT_PER_PHONE_HOUR` / `OTP_SEND_LIMIT_PER_IP_HOUR`
(`field-service/lib/rate-limit.ts`) rather than introduce duplicate
`OTP_MAX_REQUESTS_*` envs (avoids two sources of truth). The spec's
`OTP_MAX_REQUESTS_PER_PHONE_PER_HOUR` / `_PER_IP_PER_HOUR` are documented
**aliases** of these. All new envs added to `.env.local.example`.

IP hashing uses the same trusted-proxy extraction semantics as the existing
rate-limit / webhook paths: on Vercel, use the leftmost public address from
`x-forwarded-for`; fall back to `x-real-ip`; hash only after extraction. Never
trust arbitrary client-supplied IP fields in JSON bodies.

---

## 6. Step-up state machine (correction #3 — no deadlock)

Lock and step-up are **strictly sequential**, never concurrent:

```
report ─▶ LOCKED (lockedUntil = now + OTP_LOCK_MINUTES…)
            │   during lock: send-sms hook delivers NO OTP
            ▼
        (lock expiry)  OR  (admin clearLock)
            │
            ▼
        STEP_UP_PENDING (stepUpRequired = true, lockedUntil cleared)
            │   next login: Supabase OTP delivered normally,
            │   user verifies, but session gate returns STEP_UP_REQUIRED
            ▼
        user taps "Secure my account & continue"  → /api/security/otp/step-up/ack
            │   (re-OTP already satisfied by this fresh post-lock login)
            ▼
        CLEARED  → full session issued, STEP_UP_COMPLETED event
```

Because step-up only takes effect **after the lock expires (or an admin clears
it)**, the user can always receive the re-OTP needed to recover — including the
legitimate user who self-reported by accident.

Step-up factor (per decision): **Re-OTP + in-app acknowledgement**. The fresh
post-lock OTP login is the re-OTP; the ack endpoint records explicit consent and
issues the full session.

The checkpoint page does **not** ask for another OTP code. Code entry already
happened on the normal `/verify` or `/provider-verify` screen immediately before
the session gate returned `STEP_UP_REQUIRED`; the checkpoint button is only the
explicit acknowledgement step.

`POST /api/security/otp/step-up/ack` is the only endpoint that consumes the
pending cookie:
- read `pap-step-up-token`; if missing, invalid, or expired, clear it and return
  a generic "restart sign-in" response.
- decrypt and authenticate the cookie with the AES-256-GCM contract in §4.
- call `completeStepUp(phoneE164, userId)` for the cookie payload.
- issue `sb-access-token` using the encrypted `accessToken` and `maxAge`.
- clear `pap-step-up-token` in the same response (`Max-Age=0`,
  `HttpOnly; SameSite=Lax; Path=/`).

The checkpoint page never receives the access token in props, query strings, or
client-visible storage. It only posts to the ack endpoint; the endpoint owns the
cookie read, state transition, full session cookie, and pending-cookie clear.

---

## 7. Integration points (all additive, flag-guarded)

`otp_login` delivery is **left byte-for-byte unchanged** in this MVP
(correction #4 — safest for the existing journey; keeps the Meta
authentication-category copy-code/autofill button intact).

| Point | File | Change |
|---|---|---|
| Code chokepoint | `app/api/auth/hooks/send-sms/route.ts` | If `!isDeliveryAllowed(phone)` → skip `deliverOtp`, record `CANCELLED` challenge + audit + deduped `OTP_DELIVERY_REFUSED_DURING_LOCK`, return hook-success shape (no leak). UX tradeoff: a legitimate user who self-reported by mistake receives no new OTP during the lock and must retry after expiry or admin clear. Else `recordOtpChallenge()` → `deliverOtp()` → `markChallengeSent()` / `markChallengeSendFailed()`. |
| Session gate | `lib/auth-session-gate.ts` (new) | Shared lock/step-up enforcement (§4) |
| Customer session | `app/api/auth/session/route.ts` | Use the gate before `Set-Cookie`; return `stepUpRequired` / `locked` signal |
| Provider verify | `app/api/auth/provider/verify-code/route.ts` | Use the gate before `Set-Cookie`; `recordVerificationResult()` on fail |
| Customer fail telemetry | `app/api/security/otp/verify-failed/route.ts` (new) + `app/(auth)/verify/page.tsx` | Client posts `{ phoneE164 }` (never the code) on verify failure. Route calls `checkOtpVerifyLimit()` first, then `recordVerificationResult({ source: "client_telemetry" })` only when a recent active challenge exists. |
| Report API | `app/api/security/otp/report/route.ts` (new) | POST `{ token }` → `reportUnrequestedOtp({ sourceChannel: PWA_LINK })`; **always** generic success; rate-limited |
| Report page | `app/security/otp/report/page.tsx` (new, public) | Server render reads `?token=` only to hydrate the client form / one-tap auto-submit path. It never mutates state during render. All mutation goes through `POST /api/security/otp/report`; the UI message is identical regardless of token validity (no existence leak). |
| Inbound button | `app/api/webhooks/whatsapp/route.ts` → `lib/whatsapp-bot.ts` | Detect `otp_report_{signedToken}` quick-reply payload → verify the same report token used by the PWA path, require inbound `from` normalized to E.164 to equal `challenge.phoneE164`, then call `reportUnrequestedOtp({ token, sourceChannel: WHATSAPP_BUTTON })`; idempotent (existing `InboundWhatsAppMessage` dedupe + service idempotency). Reject malformed tokens, mismatched sender, and missing active challenge with the same generic user-facing response. |
| Step-up ack | `app/api/security/otp/step-up/ack/route.ts` (new) + `app/(auth)/security/checkpoint/page.tsx` (new) | Read/decrypt `pap-step-up-token`, `completeStepUp()`, issue `sb-access-token`, clear `pap-step-up-token`. |

### In-message affordance (phase-2 activation, isolated)

Reaching the victim inside WhatsApp requires a **separate Meta-approved
security template** carrying the report deep-link (URL button) and/or quick-reply
button. This is authored and activated **independently** behind
`security.otp.report`, and **never modifies the `otp_login` send path**. Until
approved + flag-on, the full report machinery (service, token, route, page,
webhook handler, admin console, lock/step-up, tests) is in place and testable;
only the live in-WhatsApp button awaits the template. Deployment dependency is
called out in §11.

Quick-reply payload budget: Meta payloads are short enough for
`otp_report_{signedToken}` because the report token contains only
`challengeId.expiry.signature`, no OTP and no PII. If a future Meta template
limits the payload below the signed-token size, keep the signed token in the URL
button and use quick reply only as a generic "open report link" affordance; do
not fall back to unsigned challenge ids.

---

## 8. WhatsApp copy (calm, non-technical; never asks for the code)

- **OTP message** (existing `otp_login`, unchanged): code body + copy-code button.
- **Report confirmation:**
  > "We've blocked that verification attempt. Your Plug A Pro account is
  > protected. If you are trying to sign in, please start again from the app."
  - **Webhook-button path:** the tap opens a 24h customer-initiated session
    window → send free-form via `sendText` (no template needed).
  - **PWA-link path:** no session window → show the confirmation **on the report
    page**; optionally a future approved template. No second message spam.
- Never states an attacker exists; never asks the user to reply with the OTP.

---

## 9. Admin console — `/admin/otp-security` (correction #6)

- Add `{ href: '/admin/otp-security', label: 'OTP Security', icon: 'workflow' as const }`
  to `ADMIN_NAV_ITEMS` (`field-service/lib/admin-nav-routes.ts`) — drives both
  sidebar and `ADMIN_SMOKE_ROUTES`. (`'workflow'` matches the existing
  Audit Log entry; swap for a dedicated icon key if one is added.)
- `app/(admin)/admin/otp-security/page.tsx`: `requireAdmin()`, renders
  **read-only for any admin** (so smoke passes flag-off). Lists `SecurityEvent`s
  with filters. Columns: eventType, severity, **masked phone** (reuse existing
  `maskPhone`), user-if-known, sourceChannel, related challenge, createdAt,
  status, metadata summary. Reuses CRUD-kit table + confirm dialog.
- `app/(admin)/admin/otp-security/actions.ts`: all via **`crudAction()`**
  (house rule #1 → AuditLog + AdminAuditEvent), gated by `admin.security.otp`:
  - `acknowledgeSecurityEventAction`
  - `resolveSecurityEventAction`
  - `markFalsePositiveAction`
  - `clearAccountLockAction` (clears lock + step-up; destructive-confirm
    pattern; roles `TRUST/ADMIN/OWNER`).

---

## 10. Audit & OpenBrain

- **System events** (requested / sent / verify-failed / expired / reported /
  locked / step-up) via existing `recordAuditLog()` (`actorRole: 'security'`).
- **Admin mutations** via `crudAction()` (dual-write).
- **OpenBrain** implementation note (domain `engineering`, project
  `Plug-A-Pro`) at completion: what was added, DB changes, routes, env vars,
  security decisions, risks/gaps, test steps. **No `tracker.md`.**

---

## 11. Rollout, flags & deployment dependencies

- Add `security.otp.report` and `admin.security.otp` to
  `field-service/lib/feature-flags-registry.ts`.
- Seed both flags in `field-service/scripts/seed-flags.ts`, flipped separately
  (house rule #5): `security.otp.report`, `admin.security.otp`.
- Keep `FLAG_KEYS` optional for this work. Prefer typed string literals
  (`'security.otp.report'`, `'admin.security.otp'`) unless an existing call site
  requires the legacy map.
- **Meta template approval** (out of our code control) gates the live
  in-WhatsApp report button only. Everything else ships and tests independently.
- Additive migration only (house rule #2); run via `pnpm db:migrate` /
  `db:migrate:prod`.
- Retention: add a scheduled pruner (or Postgres partitioning if the table grows
  faster than expected) for terminal `OtpChallenge` rows older than
  `OTP_CHALLENGE_RETENTION_DAYS` (default `30`). Keep `SecurityEvent` rows for
  the longer admin/audit retention policy; prune only high-volume challenge
  telemetry after it is terminal (`VERIFIED`, `EXPIRED`, `CANCELLED`,
  `REPORTED_UNREQUESTED`, `FAILED`).
- Operational counters/log fields: emit counts for `otp.challenge.created`,
  `otp.delivery.refused_during_lock`, `otp.report.accepted`,
  `otp.step_up.required`, `otp.step_up.completed`, and
  `otp.security_gate.unavailable`, with `traceId`, source channel, and masked
  phone only.

### 11.1 Rollback

- Flip `security.otp.report` off: the send-sms hook short-circuits to legacy
  `otp_login` delivery, report tokens/buttons are not added, and
  `recordOtpChallenge()` becomes a no-op for live delivery.
- Flip `admin.security.otp` off: admin mutation actions stop; the read-only page
  may remain reachable for smoke coverage.
- Keep the migration in place for normal rollback; additive idle tables are safe.
  If a schema rollback is required before any dependent implementation ships,
  drop only `otp_challenges`, `security_events`, and
  `account_security_states` plus their enums. They have no foreign keys from
  existing tables.

---

## 12. Edge cases → handling (spec §11)

| Edge case | Handling |
|---|---|
| Phone unknown | `userId` nullable; lock is phone-keyed |
| OTP already verified / expired | status transitions guarded; report still audited |
| Report token expired / already used | generic success; no state change; logged |
| Webhook retried / user multi-taps | idempotent service + `InboundWhatsAppMessage` dedupe |
| Legit user self-reports | sequential lock→step-up lets them recover without admin |
| Attacker spams OTPs | existing rate limits + `OTP_RATE_LIMIT_EXCEEDED` event; lock neutralises |
| Security-state DB lookup fails during session issuance | gate fails closed, withholds session, audits `security_gate_unavailable` |
| DB write ok / send fails | challenge `FAILED` |
| Send ok / no message id | `SENT` with null `providerMessageId` |
| Locked phone requests another OTP | hook refuses delivery, records `CANCELLED`, audits, and raises deduped `OTP_DELIVERY_REFUSED_DURING_LOCK` |
| Admin clears lock wrongly | audited via `crudAction`; reversible (re-lock) |
| Multiple OTPs for one phone | sibling invalidation cancels all active challenges |
| Already-delivered OTP after report | can't un-verify in Supabase; mitigated by delivery refusal + known-session revocation + withheld cookie (§2) |

---

## 13. Testing (Vitest + Playwright)

**Vitest** (`field-service/__tests__/…`, env `node`):
- code hashing never persists/logs raw code; challenge created + `SENT`.
- report token: sign/verify, tamper rejection, single-use, expiry, challenge binding.
- `reportUnrequestedOtp`: idempotency, sibling invalidation, event creation, lock+step-up applied.
- `pap-step-up-token` crypto: decrypts valid cookie; rejects wrong key,
  tampered ciphertext, tampered auth tag, expired payload, and replay after ack
  clears the cookie.
- session gate: `LOCKED` withholds cookie; `STEP_UP_REQUIRED` withholds
  `sb-access-token`, returns `pap-step-up-token`; clean phone issues cookie.
- session gate failure mode: security-state lookup error fails closed, returns
  locked/metadata, audits `security_gate_unavailable`, and sets no session
  cookie.
- challenge update: latest active challenge by phone + optional `userId` becomes
  `VERIFIED`; missing challenge records audit metadata and still allows session
  when account state allows it.
- step-up sequence: locked → no delivery; post-lock login → pending cookie →
  ack → `sb-access-token` + pending cookie cleared.
- `recordVerificationResult`: repeated failures → `OTP_VERIFICATION_FAILED_REPEATEDLY`;
  client telemetry uses `client_telemetry`, requires recent active challenge,
  and cannot create high-severity events alone.
- send-sms lock refusal: returns hook-success shape, records `CANCELLED`, audits,
  raises only one `OTP_DELIVERY_REFUSED_DURING_LOCK` per dedupe window, and does
  not call `deliverOtp()`.
- webhook report payload: signed token accepted only when inbound `from` matches
  `challenge.phoneE164`; malformed token, valid token from wrong sender, and
  challenge-id-only payloads are rejected generically.
- RLS migration coverage: new public tables have explicit `ENABLE ROW LEVEL
  SECURITY` statements and no anon/authenticated policies.
- metadata allowlists: request/security metadata schemas strip unknown keys and
  reject raw OTP, token, IP, user-agent, email, name, and provider response body
  fields.
- retention: terminal challenge rows older than `OTP_CHALLENGE_RETENTION_DAYS`
  are pruned without deleting `SecurityEvent` audit rows.
- admin RBAC: admin can read events; non-admin blocked from actions.
- report endpoint: generic responses for valid/invalid/expired/reused tokens;
  page render never mutates state and client auto-submit posts to the API.

**Playwright** (`field-service/e2e/smoke.spec.ts`):
- `/security/otp/report` renders calm message.
- `/admin/otp-security` reachable (added via `ADMIN_NAV_ITEMS`).

---

## 14. Acceptance criteria (spec §10) → coverage

Every OTP request creates an auditable `OtpChallenge` (§5,§7); raw OTP never
stored/logged (§3,§5.2); report affordance reaches the user in WhatsApp once the
phase-2 template is live, with the deep-link/webhook paths built now (§7); report
invalidates the OTP + siblings (§5); `SecurityEvent` raised (§5); temporary lock
+ step-up applied (§6); calm WhatsApp confirmation (§8); admin can manage events
+ clear locks (§9); tests cover happy/fraud/edge paths (§13); existing login
unchanged (`otp_login` untouched, §7); follows repo patterns throughout.

Known coverage gap for MVP: the original criterion "WhatsApp OTP message
includes a way to report I did not request this" is intentionally phase-2 until
Meta approves the separate security template. The signed deep-link/report API,
webhook handler, and admin/security machinery ship and test first; the
in-message affordance flips live only after template approval and
`security.otp.report` activation.
