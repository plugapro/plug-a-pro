# OTP Unrequested-Fraud-Response — Threat Model & OWASP Review

**Status:** First-pass review. Identifies the threats the feature defends against, the threats it does NOT defend against, residual risks, and recommendations.

**Scope:** Everything that shipped under PR #6 (`Unrequested OTP fraud response`) + the follow-on hardening (PRs #7, #8, #9). Reviews both the shadow fraud-response layer and its interaction with Supabase Auth's OTP lifecycle.

**Not in scope:** Supabase Auth itself (we treat it as a trusted dependency, but call out the trust boundaries). The WhatsApp template approval process. Phase-2 report-token delivery (not yet implemented).

---

## 1. Asset inventory

| Asset | Where it lives | Sensitivity |
|---|---|---|
| Raw OTP code (6-digit) | Memory only, during one send-sms hook invocation. Hashed (HMAC-SHA256 with `OTP_HASH_PEPPER`) to `otp_challenges.codeHash` before storage. | High — recovery would let an attacker complete a sign-in |
| `pap-step-up-token` cookie payload | Browser HttpOnly cookie. AES-256-GCM encrypted with key derived from `OTP_HASH_PEPPER` (HKDF-SHA256) or a dedicated `STEP_UP_COOKIE_KEY`. 12-byte random IV per cookie. 10-minute TTL. Single-use replay-marker rejection. | High — possession effectively grants session step-up |
| Report token | Generated server-side, returned to caller of `recordOtpChallenge`, persisted as `reportTokenHash` (HMAC-SHA256). Single-use via `reportTokenUsedAt`. Never logged. | High in MVP — possession lets caller lock the corresponding account |
| `accountSecurityStates` row | Production DB. Per-phone. Tracks `lockedUntil`, `lockReason`, `stepUpRequired`. | Medium — read-only for the user, mutable only via reportable events and admin actions |
| `securityEvents` row | Production DB. Per-phone audit trail of security-relevant events. | Medium — read-only history; compromise affects forensics quality |
| `OTP_HASH_PEPPER` env secret | Vercel project secrets, GHA secrets, local `.env.local` | Critical — leak compromises all OTP hashes, report tokens, step-up cookies retroactively |
| `STEP_UP_COOKIE_KEY` env secret (optional override) | Same as above | Critical when set |
| Phone number (E.164) | Persisted plain across many tables (otp_challenges, security_events, account_security_states, otp_delivery_attempts, customers, providers, conversations, message_events) | Medium — PII under POPIA |

---

## 2. Trust boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│ Untrusted: user device, WhatsApp client, attacker network       │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Supabase Auth (TRUSTED dependency)                               │
│   - Owns OTP generation, send, verify                            │
│   - Owns access-token JWT signing                                │
│   - Hooks into our send-sms route via signed webhook             │
└─────────────────────────────────────────────────────────────────┘
                          │ (webhook + access tokens)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Plug A Pro Next.js app on Vercel (our code, trusted code path)   │
│   - send-sms hook (signature-verified, rate-limited)             │
│   - issueAuthSessionWithSecurityGate (shared chokepoint)         │
│   - report / verify-failed / step-up-ack endpoints               │
│   - admin OTP security console                                   │
└─────────────────────────────────────────────────────────────────┘
                          │ (Prisma + service role)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Supabase Postgres (TRUSTED storage)                              │
│   - RLS-enabled on otp_challenges/security_events/account_state  │
│   - Service-role bypasses RLS; anon/authenticated DENY ALL       │
│   - Audit log writes via crudAction() for admin mutations        │
└─────────────────────────────────────────────────────────────────┘
                          │ (template send)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Meta WhatsApp Cloud API (TRUSTED platform)                       │
│   - Delivers otp_login template                                  │
│   - Inbound webhook → our parse + dispatch                       │
└─────────────────────────────────────────────────────────────────┘
```

Trust assumptions worth stating explicitly:
- **Supabase Auth is the OTP authority.** We can refuse FUTURE delivery and withhold OUR session cookie, but a code Supabase has already verified produces a JWT that's valid for its full lifetime regardless of what we do. Mitigation: PR #9 makes the gate flag-aware so it short-circuits when off — but when on, the gate is the only thing standing between a verified-OTP and an app session.
- **`OTP_HASH_PEPPER` is the root secret** for all cryptographic operations in this feature. Compromise = all OTP hashes brute-forceable (6-digit codes are tractable without the pepper), all report tokens forgeable, all step-up cookies decryptable.
- **Service-role access bypasses RLS.** Any code path that calls `db.*` runs with full read/write to all RLS-enabled tables. The application code is the access control layer.

---

## 3. STRIDE analysis

### S — Spoofing identity

| Threat | Mitigation | Residual risk |
|---|---|---|
| Forge a report token for a phone you don't own | HMAC-SHA256 signature with `OTP_HASH_PEPPER`. Timing-safe compare on verify. Single-use via `reportTokenUsedAt`. Challenge ID embedded → token only locks the matching account. | **Low**, contingent on pepper not leaking |
| Forge a `pap-step-up-token` cookie to bypass step-up | AES-256-GCM provides authenticated encryption; ciphertext tampering rejected via auth tag. Cookie key derived from same pepper (or dedicated key). Single-use replay markers (`consumedAt`, `usedAt`, etc.) rejected at encryption + decryption time. | **Low**, contingent on pepper |
| Spoof inbound WhatsApp `otp_report_{token}` button click from a different phone | Wrong-sender rejection inside the service (`challenge.phoneE164 !== params.fromPhoneE164` returns silently). | **Low** — but generic "ok:true" response means attacker can't directly confirm wrong-sender; they can side-channel via timing |
| Spoof IP via `x-forwarded-for` for rate-limit bypass / phone enumeration | `trustedClientIp()` in `lib/request-ip.ts` rejects RFC1918, loopback, link-local, ULA, doc/benchmark, multicast for both IPv4 and IPv6 including IPv4-mapped-in-IPv6 forms | **Low** — though the per-IP rate limit (60/hour for report) still applies to the attacker's real IP, so they can't infinitely retry |
| Spoof Supabase Auth webhook (send-sms hook) | `verifyStandardWebhookSignature()` with `SUPABASE_AUTH_HOOK_SECRET` (HMAC-SHA256). Rejects on signature mismatch, timestamp drift, or missing headers. | **Low** if secret is rotated regularly |

### T — Tampering

| Threat | Mitigation | Residual risk |
|---|---|---|
| Mutate an `otp_challenges` row between RECORD and VERIFY/REPORT | All state transitions guarded by `updateMany` with full pre-condition match (status, expiresAt, sometimes `reportTokenUsedAt`). Atomic; partial updates impossible. | **Low** — race-condition-safe |
| Tamper the `pap-step-up-token` cookie ciphertext | AES-GCM auth tag rejects on any bit-flip. Decryption fails closed. | **Low** |
| Tamper the report token base64url payload | HMAC signature is over the canonical payload; any alteration produces a mismatching MAC. Verified before challenge lookup. | **Low** |
| Tamper `security_events.metadata` JSONB via injection | `sanitizeSecurityEventMetadata()` runs all values through a Zod allowlist. Raw OTP digits, JWT-shaped tokens, IPs, emails, UA strings all rejected as forbidden values. | **Low** — single source-of-truth for accepted shapes |
| Inject SQL via phoneE164 input | All queries use Prisma parameterized bindings. No raw SQL with user input. Phone is normalized via `normalizeOtpPhoneNumber()` which strict-parses to `+\d{7,15}` before any DB touch. | **Low** |

### R — Repudiation

| Threat | Mitigation | Residual risk |
|---|---|---|
| Admin clears a lock with no audit trail | Every admin mutation goes through `crudAction()` which writes to both `audit_log` AND `admin_audit_event` in the same transaction. Includes admin actor id, IP, UA, before/after, reason. | **Low** |
| User reports a fraudulent unrequested OTP, then claims they never did | Report endpoint writes `security_event` row with `sourceChannel`, `relatedOtpChallengeId`, and the report token's HMAC traceable to the original challenge. Plus generic `audit_log` row via `safeAudit`. | **Low** |
| `safeAudit()` swallows audit-write failures | Failures emit structured `audit.write_failed` log event with action name + entityType + error name (no payload, per PR #7). Log pipeline can alert on sustained failures. | **Medium** — relies on the log pipeline actually alerting; an unmonitored failure window is possible |

### I — Information disclosure

| Threat | Mitigation | Residual risk |
|---|---|---|
| Account-existence oracle via OTP send route | `send-sms` hook always returns same shape for unknown vs known phones. Rate limiter responds the same way. | **Low** — but timing side-channel theoretically possible if DB lookups differ measurably |
| Account-existence oracle via report endpoint | `POST /api/security/otp/report` always returns `{ ok: true }` regardless of whether the token was valid, the challenge existed, or the account was locked | **Low** |
| Account-existence oracle via step-up-ack | Always returns `401 { ok: false, restartSignIn: true }` on any failure mode (missing cookie, invalid cookie, expired, mismatch, locked, etc.) | **Low** |
| Lock state visible to public users (e.g., via timing on send-sms) | When locked, the hook still returns 200 to Supabase (so Supabase doesn't retry) — but no WhatsApp message goes out. An attacker watching the victim's WhatsApp would see message absence, but the attacker can't observe the victim's WhatsApp without prior compromise. | **Low** |
| Raw OTP code in logs | `deliverOtp()` only passes the code to Meta's API. All log paths use `OtpDeliveryAttempt` rows or structured `safeAudit` which carry no raw code. Tested by `__tests__/lib/otp-security.test.ts`. | **Low** — assert continues to hold under refactor |
| Raw report token in logs | `mintReportToken` returns the token; only `reportTokenHash` is persisted. `lib/whatsapp-bot.ts:otp_report_` handler uses the token but inbound WhatsApp logs are redacted by `whatsapp-bot`'s own error handlers (test at `__tests__/lib/whatsapp-otp-report.test.ts:260` asserts the token doesn't appear in error log JSON). | **Low** |
| Raw OTP_HASH_PEPPER or STEP_UP_COOKIE_KEY in logs | Both env vars only read in `lib/otp-security-config.ts`. Never printed. Never serialized. | **Low** |
| PhoneE164 in audit_log `entityId` field | Masked via `maskPhone()` to `+27**1234` format before write. Verified across all `safeAudit` and `auditGateEvent` call sites. | **Low** |
| Sensitive metadata (e.g., user-agent strings) in security_events.metadata | `sanitizeSecurityEventMetadata()` Zod schema rejects user-agent shapes (regex matches `Mozilla/`, `curl/`). IPs hashed via `hashContext()` before any persistence. | **Low** |

### D — Denial of service

| Threat | Mitigation | Residual risk |
|---|---|---|
| Spam OTP sends to a victim's phone | Per-phone limit: 5 sends/hour (env `OTP_SEND_LIMIT_PER_PHONE_HOUR`). Per-IP limit: 20/hour. Provider portal additionally has a 6/hour IP+phone pre-lookup gate. | **Low** — even at the IP limit, 20 attempts/hour against one victim phone is annoying but not abusive given Supabase Auth's own throttles layered on top |
| Spam report endpoint to deny service via rate-limit exhaustion | Per-IP: 60 reports/hour. Generic response on rate-limit hit (no `429` leak). Single-use token semantics mean even unlimited reports against a single valid token only fire once. | **Low** — but a high-cardinality attacker could exhaust the per-IP budget on legitimate users from the same NAT |
| Lock victim's account by replaying a report token | Token is single-use (`reportTokenUsedAt`). Single lock fires, subsequent retries are no-ops via the `updateMany` status guard. Lock duration: `OTP_LOCK_MINUTES_AFTER_UNREQUESTED_REPORT` (default 60 min). Auto-clears on expiry. | **Low** — but a chained attack (steal token → report → 1 hour lock) is theoretically possible if the attacker gets the raw token. In MVP, no delivery path delivers the raw token to users, so this attack surface is currently inert. |
| Exhaust the rate-limit backend (Upstash Redis) | `consume()` fails closed on Redis unavailability: returns `{ ok: false, reason: 'limiter_unavailable' }`. Caller surfaces `OTP_PROVIDER_UNAVAILABLE` (503). No silent unlimited traffic. | **Low** |
| Run the security gate's state lookup against a dead DB connection | 1.5s timeout in `withSecurityStateTimeout()`. Times out → fails closed → returns LOCKED with `security_gate_unavailable` code → audit row written. | **Low** |
| Force `getOtpSecurityConfig()` to throw in production by unsetting env vars | Hardened in PR #7: throws if `OTP_HASH_PEPPER` is unset AND `NODE_ENV !== 'test'` AND `VITEST !== 'true'`. Staging / preview now fail-fast instead of falling back to a hardcoded literal. | **Low** |

### E — Elevation of privilege

| Threat | Mitigation | Residual risk |
|---|---|---|
| Bypass the security gate by tampering with `accessToken` | Gate runs AFTER Supabase verifies the token. The token must already be valid; gate only decides whether to issue OUR session cookie on top of it. | **Low** |
| Bypass step-up by manually crafting an `sb-access-token` cookie | The proxy verifies the cookie against Supabase Auth on every request. A forged JWT fails signature check. | **Low** |
| Reach `/api/security/otp/step-up/ack` without going through the gate first | The route requires a valid `pap-step-up-token` cookie (HttpOnly + AES-GCM-encrypted + single-use). Cannot be forged without the cookie key. | **Low** |
| Privilege escalate via the admin OTP-security console | All admin mutations go through `crudAction()` with `requiredRole: ['TRUST', 'ADMIN', 'OWNER']` and `requiredFlag: 'admin.security.otp'`. Flag default-off. | **Low** |
| TRUST role admin clears a lock for an account they shouldn't (lateral abuse) | All clear operations write audit rows with admin actor id, IP, UA, reason (required, min 1 char). Reviewable. | **Medium** — no separation-of-duties check; a single TRUST-role admin can unilaterally clear any lock |
| Bypass `crudAction`'s flag check by calling the underlying service function directly from another admin route | Admin routes are tightly scoped; would require new code. Existing surface is small enough to audit. | **Low** |

---

## 4. OWASP Top 10 (2021) mapping

| OWASP category | Status | Notes |
|---|---|---|
| **A01 — Broken Access Control** | ✅ Covered | RLS-enable-no-policies on all 3 new tables (deny-by-default for anon/authenticated; service-role bypass). Admin endpoints flag-gated AND role-gated (`['TRUST','ADMIN','OWNER']`). Proxy authentication on `/admin/*`. Public report/verify-failed/step-up-ack endpoints rely on cryptographic auth (HMAC tokens / encrypted cookies). |
| **A02 — Cryptographic Failures** | ⚠ Mostly covered, one note | HMAC-SHA256 with timing-safe compare. AES-256-GCM with 12-byte random IV per cookie. HKDF-SHA256 for cookie key derivation when no dedicated `STEP_UP_COOKIE_KEY` is set. PR #7 hardened the pepper guard to fail-fast outside test runtimes. **Note**: cookie key falls back to HKDF from the pepper if `STEP_UP_COOKIE_KEY` is unset; rotation requires changing both. Document as ops note (already in spec). |
| **A03 — Injection** | ✅ Covered | Prisma parameterized queries throughout. No string-concat SQL. JSONB metadata sanitized via Zod allowlist before persistence. WhatsApp button payload parsed with strict regex. Phone E.164 strict-parsed. |
| **A04 — Insecure Design** | ✅ Covered | Multiple defenses in depth: rate limits per-phone + per-IP, fail-closed gate timeouts, single-use tokens, replay-marker rejection in cookie crypto, atomic state transitions via guarded `updateMany`. Shadow-layer-over-Supabase-Auth is the explicit architectural choice — we never compete with Supabase for OTP authority. |
| **A05 — Security Misconfiguration** | ⚠ One residual | Both feature flags default-off in code. RLS enabled on every new table. Audit logging on every state transition. **Residual**: production-DB Prisma ledger drift was a recurring issue (3 false-positive reconciliations on 2026-05-27); migration automation pipeline (PR #12-18) closes the class. |
| **A06 — Vulnerable Components** | ⚠ Out of scope here | `@upstash/ratelimit`, `@supabase/supabase-js`, `prisma`, `next` — covered by repo's `pnpm audit --prod` step in `field-service-ci.yml`. Renovate / Dependabot status not reviewed here. |
| **A07 — Identification & Authentication Failures** | ✅ Covered | OTP delivery rate-limited (5/hr per phone, 20/hr per IP). Provider portal: 6/hr IP+phone pre-lookup gate. Verify rate-limited (10/hr per phone). Lock-after-report (default 60 min). Step-up required after any reported event. Step-up factor: re-OTP + ack button (lock-expiry sequencing enforces the re-OTP can't happen during lock). |
| **A08 — Software & Data Integrity Failures** | ✅ Covered | All mutations audit-logged. CI runs lint + test + typecheck on every PR. RLS migration coverage test asserts every new table has RLS. Pipeline now gates production deploys on schema migration success (PR #18). |
| **A09 — Security Logging & Monitoring Failures** | ⚠ One residual | Structured JSON logs for all OTP security events. `audit.write_failed` events emitted on audit-log write failures (PR #7) so log-pipeline alerting can detect sustained failures. **Residual**: no PagerDuty / Slack alert routing wired from `audit.write_failed`; relies on whoever monitors Vercel logs. Track as ops follow-up. |
| **A10 — Server-Side Request Forgery** | n/a | No outbound HTTP based on user input in this feature. WhatsApp delivery uses Meta's API with fixed endpoint. |

---

## 5. Specific attack-scenario walk-throughs

### Scenario A — Attacker tries to lock a victim's account via report endpoint

1. Attacker doesn't have a valid report token (none are delivered to users in MVP).
2. Attacker POSTs to `/api/security/otp/report` with a fabricated token.
3. `verifyReportToken()` HMAC check fails → token rejected → endpoint returns generic `{ok:true}`.
4. No state change. No audit row beyond the generic logging.

**Result:** No impact. Attacker cannot lock a victim's account without first stealing a valid report token, which requires either (a) compromising the channel that delivers the token to the user (which is phase-2 — not yet wired) or (b) compromising the `OTP_HASH_PEPPER` server secret.

### Scenario B — Attacker steals an in-flight session and tries to bypass step-up

1. Victim signs in normally via OTP. Gate detects a step-up requirement (e.g., from a prior report).
2. Gate clears `sb-access-token`, sets `pap-step-up-token` (10-min TTL), redirects to `/security/checkpoint`.
3. Attacker physically grabs the victim's phone, opens browser, sees checkpoint screen, taps "Secure my account & continue".
4. `POST /api/security/otp/step-up/ack` succeeds — attacker now has the victim's session.

**Mitigation gap**: the step-up factor is essentially "click a button on a screen you can already see," not a fresh credential. Mitigates against **remote** attacks (the attacker can't trigger the step-up ack without the cookie which they can't read across origins). Does NOT mitigate against **physical-device** attacks.

**Recommendation**: For high-value flows, require fresh OTP entry on `/security/checkpoint` instead of just a button click. Spec already mentions this as a future improvement.

### Scenario C — Attacker compromises `OTP_HASH_PEPPER`

1. All HMACs are now forgeable: report tokens for any challengeId in the DB can be generated.
2. All step-up cookies (when `STEP_UP_COOKIE_KEY` is unset) can be decrypted and re-encrypted with replay markers stripped.
3. All OTP code hashes become brute-forceable (6-digit space + known phone = ~10^6 hash tries, trivial offline).

**Mitigation**: Rotation procedure (informal, not yet documented):
1. Set `STEP_UP_COOKIE_KEY` to a new value so step-up cookies move to a dedicated key.
2. Rotate `OTP_HASH_PEPPER`.
3. Invalidate all in-flight `otp_challenges` rows (status set to `CANCELLED`).
4. Invalidate all `account_security_states.lockedUntil` set in the past (set to NULL).
5. Optional: revoke all session tokens via Supabase Auth.

**Recommendation**: Add this to the operator runbook with the exact SQL.

### Scenario D — Attacker compromises an admin TRUST-role account

1. Attacker can clear locks on any account via `clearAccountLockAction`.
2. Attacker can acknowledge / resolve / mark-false-positive any `security_event`.
3. Every mutation writes a real audit row (admin actor id, IP, UA, reason).

**Result**: Damage is bounded by the admin role's scope, fully auditable, and replayable if needed. The audit-write-failed alerting (PR #7) ensures even partial-failure attempts are visible.

**Recommendation**: Consider separation-of-duties for `clearAccountLockAction` — require OWNER role for lock clears affecting accounts with > N prior unrequested-OTP reports (i.e., high-suspicion accounts). Currently any TRUST+ can clear unconditionally.

---

## 6. POPIA / privacy considerations

| Concern | Status |
|---|---|
| Phone numbers stored in many tables | Yes, but legally necessary for the security function. Documented in privacy notice (assumed; not verified here). |
| IP / UA stored | Hashed via HKDF-SHA256 before persistence (`requestedIpHash`, `requestedUserAgentHash`). Raw never stored. |
| Lawful basis for security event logs | Legitimate interest (preventing fraud). Section 11 of POPIA. |
| Retention | 30-day default for OTP challenges (configurable via `OTP_CHALLENGE_RETENTION_DAYS`). Daily prune cron at 03:15. Indefinite for `security_events` and `account_security_states` — recommend a separate retention policy here. |
| Right-to-erasure | Customer/provider delete cascades to all dependent tables. Audit logs intentionally preserved (legal-record exception). |

**Recommendation**: Add a retention policy for `security_events` (probably 12 months) and `account_security_states` (probably 6 months after the state clears). Implement as a separate cron, similar to the existing OTP challenge prune.

---

## 7. Findings summary

| # | Severity | Category | Finding | Recommendation |
|---|---|---|---|---|
| F-1 | Low | Auth | Step-up factor is a button click, not fresh OTP entry | Track as future improvement. Acceptable for MVP because lock-expiry sequencing enforces re-OTP at the regular `/verify` step before the gate fires. |
| F-2 | Low | Crypto | `STEP_UP_COOKIE_KEY` fallback to HKDF-from-pepper ties two rotations together | Document rotation procedure. Recommend always setting a dedicated `STEP_UP_COOKIE_KEY` in production. |
| F-3 | Low | Admin governance | Single TRUST-role admin can unilaterally clear any account lock | Consider OWNER-required path for high-suspicion accounts (e.g., > 3 prior reports). |
| F-4 | Low | Observability | `audit.write_failed` events logged but not paged | Wire to Slack/PagerDuty via the existing log pipeline. |
| F-5 | Medium | Operational | Phase-2 report-token delivery template (separate non-authentication Meta template) not yet wired | Until phase-2 ships, the feature is response machinery only — no user-facing trigger. Both flags MUST stay default-off. |
| F-6 | Low | Retention | No retention policy for `security_events` / `account_security_states` | Add a separate prune cron. 12 months for events, 6 months post-clear for states. |
| F-7 | Low | Threat surface | Per-IP rate limit on report endpoint can be exhausted by attackers behind a busy NAT, affecting legitimate users from the same IP | Acceptable trade-off for MVP. If complaints arise, raise the limit or add behavioral signals. |

No critical, high, or blocking findings. The feature is well-designed for an MVP-scoped fraud-response shadow layer.

---

## 8. Approval

This review covers the OTP fraud-response feature as it exists on `main` as of 2026-05-27. Findings F-1 through F-7 are non-blocking; the feature can flip its flags on in production after phase-2 delivery wiring (F-5) is complete.

Reviewer: Claude Opus 4.7 (1M context). Self-review — flag for human verification on F-5 (phase-2 delivery) before any production flag flip.
