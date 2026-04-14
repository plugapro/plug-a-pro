# Plug-A-Pro — Staging Smoke Test

> Run this checklist after every deployment to staging or production.
> Each item must pass before the deployment is considered stable.

---

## Prerequisites

- Staging URL: `https://app-staging.plugapro.co.za` (update when provisioned)
- Admin credentials available
- Test customer phone number (SMS-capable)
- Test provider account in staging DB
- WhatsApp test number configured in Meta Sandbox

---

## 1. Marketing Site

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 1.1 | Load homepage | 200, no console errors | ☐ |
| 1.2 | Load `/pricing` | 200, correct plan data | ☐ |
| 1.3 | Load `/faq` | 200, FAQ items rendered | ☐ |
| 1.4 | Load `/contact` | 200 | ☐ |
| 1.5 | Chat widget opens | Widget appears, sends message | ☐ |

---

## 2. Customer Auth Flow

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 2.1 | Load `/sign-in` | Phone input renders | ☐ |
| 2.2 | Submit valid phone | OTP sent, redirected to `/verify` | ☐ |
| 2.3 | Enter OTP | Redirected to `/bookings` | ☐ |
| 2.4 | Verify session cookie is `HttpOnly` | Cookie not readable via `document.cookie` in devtools console | ☐ |
| 2.5 | Load `/bookings` without sign-in | Redirected to `/sign-in` | ☐ |

**Verify HttpOnly cookie (manual):**
```
1. Open DevTools → Console
2. Type: document.cookie
3. Result must NOT contain `sb-access-token`
4. Open DevTools → Application → Cookies
5. `sb-access-token` must show HttpOnly=true
```

---

## 3. Provider Auth Flow

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 3.1 | Load `/provider-sign-in` | Phone input renders | ☐ |
| 3.2 | Sign in with approved provider phone | Redirected to `/provider` | ☐ |
| 3.3 | Sign in with unapproved phone | Error message shown | ☐ |
| 3.4 | Load `/provider` without sign-in | Redirected to `/provider-sign-in` | ☐ |

---

## 4. Admin Auth Flow

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 4.1 | Load `/admin-sign-in` | Email/password form renders | ☐ |
| 4.2 | Sign in with valid admin credentials | Redirected to `/admin` | ☐ |
| 4.3 | Sign in with non-admin account | Error: "does not have admin access" | ☐ |
| 4.4 | Load `/admin` without sign-in | Redirected to `/admin-sign-in` | ☐ |

---

## 5. WhatsApp Webhook

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 5.1 | `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=abc` | Returns `abc` (200) | ☐ |
| 5.2 | `GET /api/webhooks/whatsapp?hub.verify_token=wrong` | Returns 403 | ☐ |
| 5.3 | `POST /api/webhooks/whatsapp` with no signature header | Returns 403 | ☐ |
| 5.4 | `POST /api/webhooks/whatsapp` with valid Meta signature | Returns 200 | ☐ |

**Test webhook verification (CLI):**
```bash
curl -s "https://app-staging.plugapro.co.za/api/webhooks/whatsapp?\
hub.mode=subscribe&\
hub.verify_token=${WHATSAPP_VERIFY_TOKEN}&\
hub.challenge=test-challenge-123"
# Expected: test-challenge-123

# Test signature rejection
curl -s -X POST "https://app-staging.plugapro.co.za/api/webhooks/whatsapp" \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
# Expected: {"error":"Forbidden"} (403)
```

---

## 6. Cron Route Security

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 6.1 | `GET /api/cron/match-leads` (no auth) | 401 Unauthorized | ☐ |
| 6.2 | `GET /api/cron/match-leads` (with `Authorization: Bearer <CRON_SECRET>`) | 200 | ☐ |
| 6.3 | `GET /api/cron/reminders` (no auth) | 401 | ☐ |
| 6.4 | `GET /api/cron/follow-up` (no auth) | 401 | ☐ |

**CLI:**
```bash
curl -s https://app-staging.plugapro.co.za/api/cron/match-leads
# Expected: 401

curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://app-staging.plugapro.co.za/api/cron/match-leads
# Expected: 200, JSON result
```

---

## 7. Database Migration

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 7.1 | `prisma migrate status` on staging DB | No pending migrations | ☐ |
| 7.2 | App boots without DB errors | No "relation does not exist" in logs | ☐ |
| 7.3 | Admin panel loads customer list | Data renders | ☐ |

---

## 8. Core Marketplace Loop (end-to-end)

> Full walkthrough — run before first production launch.

| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 8.1 | Provider account approved in admin panel | Provider `userId` has `role: provider` in Supabase metadata | ☐ |
| 8.2 | Provider appears in matching query | `dispatchLeads` returns provider as candidate | ☐ |
| 8.3 | Customer submits job request | `JobRequest` created with `status: OPEN` | ☐ |
| 8.4 | Run match-leads cron (manual trigger) | Lead dispatched, WhatsApp sent to provider | ☐ |
| 8.5 | Provider accepts lead | `Lead.status → ACCEPTED`, `JobRequest.status → MATCHED` | ☐ |
| 8.6 | Customer pays | Payment confirmed, `Booking.status → SCHEDULED` | ☐ |
| 8.7 | Customer receives WhatsApp booking confirmation | Message received on test number | ☐ |
| 8.8 | Duplicate payment webhook delivered | No second WhatsApp message sent | ☐ |

---

## Sign-Off

| Role | Name | Date | Pass? |
|------|------|------|-------|
| Engineering | | | ☐ |
| Product | | | ☐ |
| Operations | | | ☐ |
