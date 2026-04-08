# WhatsApp Template Verification

**Date:** 2026-04-08
**Verified by:** Claude (automated — Meta Graph API v21.0)
**WABA checked:** `104200...7877` (from `field-service/.env.production.local`)
**Verdict:** ⛔ LAUNCH-BLOCKED — no production templates approved

---

## 1. Verified Templates

| Template | Status | Category | Language |
|----------|--------|----------|----------|
| `sample_template` | APPROVED | UTILITY | en_US |

One template found. `sample_template` is the default Meta sandbox placeholder and is not used by any runtime code.

---

## 2. Missing / Not-Approved Templates

All 21 templates in `lib/messaging-templates.ts` are absent from the WABA. The registration script comments ("9 templates already APPROVED in en_ZA") do not reflect the current Meta state for this WABA ID.

### Group A — Previously claimed approved in en_ZA (script comment, not verified in Meta)

| Template | Category | Claimed status |
|----------|----------|----------------|
| `booking_confirmation` | UTILITY | "already approved" (script comment) |
| `booking_reminder` | UTILITY | "already approved" |
| `booking_cancelled` | UTILITY | "already approved" |
| `technician_on_the_way` | UTILITY | "already approved" |
| `technician_arrived` | UTILITY | "already approved" |
| `extra_work_approval` | UTILITY | "already approved" |
| `job_completed` | UTILITY | "already approved" |
| `follow_up` | UTILITY | "already approved" |
| `quote_ready` | UTILITY | "already approved" |

None of these appear in the WABA. Either the comments are incorrect, or these were approved on a different WABA that is not configured in the current environment.

### Group B — Registered as new via `register-whatsapp-templates.mjs`

| Template | Category |
|----------|----------|
| `booking_rescheduled` | UTILITY |
| `payment_reminder` | UTILITY |
| `payment_received` | UTILITY |
| `technician_assigned` | UTILITY |
| `slot_available` | MARKETING |
| `no_technician_available` | UTILITY |
| `job_offer` | MARKETING |
| `technician_job_reminder` | UTILITY |
| `technician_payment_released` | UTILITY |
| `technician_application_received` | UTILITY |
| `technician_welcome` | MARKETING |
| `technician_application_declined` | UTILITY |

None of these appear in the WABA either.

---

## 3. Runtime Impact

### Hard failures (template API call returns error at send time)

Every `sendTemplate()` call will fail at runtime because the named template does not exist in this WABA. The code suppresses errors in most paths (`.catch(() => {})`), so **failures will be silent in production** — no WhatsApp notification is sent and no error surfaces to the user or monitoring.

| Flow | Template required | Impact if missing |
|------|------------------|-------------------|
| Customer quote approval | `quote_ready` | Customer never receives quote link — **quote flow dead end** |
| Booking confirmed | `booking_confirmation` | No booking confirmation sent |
| Booking cancellation | `booking_cancelled` | No cancellation notice |
| Provider en route | `technician_on_the_way` | No ETA alert |
| Provider arrived | `technician_arrived` | No arrival notification |
| Extra work found | `extra_work_approval` | Extra work approval link never delivered |
| Job completed | `job_completed` | No completion notice, no invoice link |
| Pre-job reminder (cron) | `booking_reminder` | Reminder cron silently drops |
| Post-job follow-up (cron) | `follow_up` | Rating request never sent |
| Payment reminder (cron) | `payment_reminder` | Payment reminder silently drops |
| Payment confirmed | `payment_received` | No explicit payment receipt |
| Technician assigned | `technician_assigned` | No assignment notification |
| Booking rescheduled | `booking_rescheduled` | No reschedule notice |
| No match found | `no_technician_available` | Customer gets no feedback |
| Application declined | `technician_application_declined` | Decline message never sent (direct `sendTemplate` call, no fallback) |
| Application received | `technician_application_received` | ACK never sent |

### Not blocked by template approval

These flows use interactive WhatsApp messages (buttons / CTA), not templates, and work within an active 24-hour conversation window:

| Flow | Mechanism |
|------|-----------|
| Lead dispatch to provider | `sendButtons` — works in active 24h window |
| Application approval notification | `sendCtaUrl` — works in active 24h window |
| General bot conversation (text replies) | `sendText` — no template needed |

> **Important caveat:** Lead dispatch (`notifyProviderNewJob`) uses interactive buttons only within an active conversation. A provider who has not messaged the bot in the past 24 hours **cannot** be reached without a template. `job_offer` is the template for this out-of-window case. It is also missing.

---

## 4. Launch Recommendation

**Do not go live until templates are approved.**

The `quote_ready` template is the minimum required for the core loop: without it, a customer who receives a quote cannot be notified to review it. The entire marketplace flow stalls at the quote step.

The `technician_application_declined` path calls `sendTemplate` directly without a policy bypass fallback, so declined applicants will receive no message and the admin decline action will silently fail.

---

## 5. Operator Actions Required

### Immediate (before launch)

**Step 1 — Confirm WABA identity**

The WABA ID in `.env.production.local` returns only `sample_template`. Determine whether this is:

- **The correct production WABA** that has never had templates registered → proceed to Step 2.
- **A test/sandbox WABA** and the real production WABA has a different ID → update `WHATSAPP_WABA_ID` and `WHATSAPP_PHONE_NUMBER_ID` in `field-service/.env.production.local` (and Vercel env vars) to the live WABA, then query that WABA's template state.

Check in Meta Business Manager: **Business Settings → WhatsApp Accounts**. The registered phone number for the production WABA should be the South African number used by live users.

**Step 2 — Register all 21 templates if not already present**

```bash
cd field-service
WHATSAPP_ACCESS_TOKEN=<prod-token> \
WHATSAPP_WABA_ID=<prod-waba-id> \
node scripts/register-whatsapp-templates.mjs
```

This will register the 12 new templates (Group B). For the 9 Group A templates, if they genuinely exist on a different WABA, they must also be registered on the correct WABA.

> Do NOT use `--delete-rejected` unless you have confirmed the rejected IDs in the script still exist and belong to this WABA.

**Step 3 — Wait for Meta review (24–72 hours)**

After submission, each template enters `PENDING` status. Meta review can take up to 72 hours for UTILITY templates and longer for MARKETING templates. Plan the launch window accordingly.

**Step 4 — Verify approval before go-live**

Rerun the query after review completes:

```bash
source field-service/.env.production.local
curl -s "https://graph.facebook.com/v21.0/${WHATSAPP_WABA_ID}/message_templates?limit=200&fields=name,status,category&access_token=${WHATSAPP_ACCESS_TOKEN}" | python3 -m json.tool
```

All UTILITY templates must show `APPROVED`. MARKETING templates (`slot_available`, `job_offer`, `technician_welcome`) must also be approved before those flows are used.

**Step 5 — Update this document** with the verified approval state and date.

---

## Remediation Timeline Estimate

| Phase | Duration |
|-------|----------|
| WABA identity confirmation | 1–2 hours (manual check in Meta Business Manager) |
| Template registration (script) | < 30 minutes |
| Meta review for UTILITY templates | 24–72 hours |
| Meta review for MARKETING templates | 48–72 hours (sometimes longer) |
| Final verification query | 15 minutes |
| **Total estimated lead time** | **2–4 days** |

---

## Notes on Repository vs Reality

The comment in `register-whatsapp-templates.mjs` states:

> *"The 9 templates already APPROVED in en_ZA are NOT re-submitted here"*

This comment is misleading. The 9 templates it lists are absent from the queried WABA. The registration script will need to be run for all 21 templates, or a separate registration pass must be done for the Group A templates if they belong to a different WABA.

The `docs/spec-trace-marketplace-model-2026-04-08.md` correctly identified this as "Not verifiable from repository evidence." This document provides that verification.
