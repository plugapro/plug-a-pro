# WhatsApp Template Verification

**Initial check date:** 2026-04-08 (morning)
**Updated:** 2026-04-08 (evening) — all 21 templates registered
**Verified by:** Claude (automated — Meta Graph API v21.0 + Meta Business Manager)
**WABA checked:** `104200042667877` — confirmed production WABA under "Kgolaentle Holdings", phone +27 69 355 2447
**Verdict:** 🔄 TEMPLATES REGISTERED — awaiting Meta approval for 14 PENDING templates

---

## 1. Template State (as of 2026-04-08 evening)

All 21 production templates have been submitted to Meta. Current approval state:

| Template | Status | Category | Notes |
|----------|--------|----------|-------|
| `technician_application_declined` | APPROVED | UTILITY | Pre-existing |
| `technician_welcome` | APPROVED | MARKETING | Pre-existing |
| `technician_job_reminder` | APPROVED | UTILITY | Pre-existing |
| `job_offer` | APPROVED | MARKETING | Pre-existing |
| `no_technician_available` | APPROVED | UTILITY | Pre-existing |
| `slot_available` | APPROVED | MARKETING | Pre-existing |
| `payment_received` | APPROVED | UTILITY | Pre-existing |
| `booking_confirmation` | PENDING | UTILITY | Registered 2026-04-08 |
| `booking_reminder` | PENDING | UTILITY | Registered 2026-04-08 |
| `booking_cancelled` | PENDING | UTILITY | Registered 2026-04-08 |
| `technician_on_the_way` | PENDING | UTILITY | Registered 2026-04-08 (body rewritten — see §4) |
| `technician_arrived` | PENDING | UTILITY | Registered 2026-04-08 |
| `extra_work_approval` | PENDING | UTILITY | Registered 2026-04-08 |
| `job_completed` | PENDING | UTILITY | Registered 2026-04-08 |
| `follow_up` | PENDING | UTILITY | Registered 2026-04-08 |
| `quote_ready` | PENDING | UTILITY | Registered 2026-04-08 — **critical path** |
| `booking_rescheduled` | PENDING | UTILITY | Registered 2026-04-08 |
| `payment_reminder` | PENDING | UTILITY | Registered 2026-04-08 |
| `technician_assigned` | PENDING | UTILITY | Registered 2026-04-08 |
| `technician_payment_released` | PENDING | UTILITY | Registered 2026-04-08 |
| `technician_application_received` | PENDING | UTILITY | Registered 2026-04-08 |

**Summary: 7 APPROVED · 14 PENDING · 0 REJECTED**

> `sample_template` (APPROVED, en_US) is also present — Meta default placeholder, not used by runtime code.

---

## 2. Registration History

### Morning check (initial state)

WABA `104200042667877` contained only `sample_template`. All 21 production templates were absent. The registration script comment ("9 templates already APPROVED in en_ZA") did not reflect this WABA's state.

**WABA identity confirmed:** Meta Business Manager → Business Settings → WhatsApp Accounts shows `104200042667877` is the production WABA under "Kgolaentle Holdings" with production phone +27 69 355 2447. Not a sandbox account.

### Evening registration pass

**Group A (9 templates):** Registered via inline Node.js script using Meta Graph API POST `/{waba-id}/message_templates`. These were the templates the registration script incorrectly assumed were already approved.

**Group B (12 templates):** Registered via `field-service/scripts/register-whatsapp-templates.mjs`.

---

## 3. Runtime Impact

### Still blocked (PENDING templates)

The 14 PENDING templates cover the core transactional flows. Until `quote_ready` is approved, the marketplace loop cannot complete end-to-end.

| Flow | Template required | Blocked? |
|------|------------------|----------|
| Customer receives quote link | `quote_ready` | 🔴 Yes — **critical path** |
| Booking confirmation | `booking_confirmation` | 🔴 Yes |
| Booking cancellation | `booking_cancelled` | 🔴 Yes |
| Provider en route alert | `technician_on_the_way` | 🔴 Yes |
| Provider arrived | `technician_arrived` | 🔴 Yes |
| Extra work approval | `extra_work_approval` | 🔴 Yes |
| Job completed / invoice | `job_completed` | 🔴 Yes |
| Pre-job reminder (cron) | `booking_reminder` | 🔴 Yes |
| Post-job follow-up (cron) | `follow_up` | 🔴 Yes |
| Payment reminder (cron) | `payment_reminder` | 🔴 Yes |
| Technician assigned | `technician_assigned` | 🔴 Yes |
| Booking rescheduled | `booking_rescheduled` | 🔴 Yes |
| Provider payment released | `technician_payment_released` | 🔴 Yes |
| Application received ACK | `technician_application_received` | 🔴 Yes |

### Already working (APPROVED templates)

| Flow | Template | Status |
|------|----------|--------|
| Application declined | `technician_application_declined` | ✅ Approved |
| Provider welcome message | `technician_welcome` | ✅ Approved |
| Provider job reminder | `technician_job_reminder` | ✅ Approved |
| Lead dispatch (out-of-window) | `job_offer` | ✅ Approved |
| No match found | `no_technician_available` | ✅ Approved |
| Slot availability push | `slot_available` | ✅ Approved |
| Payment confirmation | `payment_received` | ✅ Approved |

### Not blocked by template approval

These flows use interactive WhatsApp messages (buttons / CTA) within an active 24-hour conversation window:

| Flow | Mechanism |
|------|-----------|
| Lead dispatch to provider (in-window) | `sendButtons` |
| Application approval notification | `sendCtaUrl` |
| General bot conversation | `sendText` |

---

## 4. Registration Notes

### `technician_on_the_way` body rewrite

The original body was:

```
Hi {{1}}, {{2}} is on their way and will arrive in {{3}}. Track your job at {{4}}.
```

Meta rejected this with error `"Leading or trailing params not allowed"` — `{{2}}` was treated as a leading parameter in the sentence fragment following the comma.

Approved body used for registration:

```
Hi {{1}}, your Plug A Pro technician {{2}} is heading your way now. Expected arrival in {{3}} — see you soon!
```

> **Note:** The body registered with Meta now differs from what is in `lib/messaging-templates.ts`. Once Meta approves this template, update `messaging-templates.ts` to match the registered body to avoid variable-mapping mismatches at send time.

### Display name

"PlugAPro" was auto-rejected by Meta. "Plug A Pro" was submitted as a replacement and is currently showing "In review" status in Meta Business Manager (Edit button is disabled, indicating manual review is in progress).

---

## 5. Go-Live Requirement

**Do not go live until `quote_ready` and all other PENDING UTILITY templates are approved.**

The marketplace core loop — customer receives quote notification → approves quote → booking created — requires `quote_ready`. Without it, every `sendTemplate('quote_ready', ...)` call will fail silently (code suppresses errors with `.catch(() => {})`).

### Operator action required before launch

**Verify template approval state:**

```bash
# Load the token into the shell env only (never echo it). Pass it in the
# Authorization header — NOT as an access_token query parameter, which leaks
# into proxy logs, process accounting, and browser/CLI history.
source field-service/.env.production.local
curl -s \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  "https://graph.facebook.com/v21.0/${WHATSAPP_WABA_ID}/message_templates?limit=200&fields=name,status,category" \
  | python3 -m json.tool
```

All UTILITY templates must show `APPROVED`. All MARKETING templates (`slot_available`, `job_offer`, `technician_welcome`) must also be approved.

**Update this document** once all templates show APPROVED, and update the verdict line above.

---

## 6. Timeline Estimate (remaining)

| Phase | Duration |
|-------|----------|
| Meta review for UTILITY templates | 24–72 hours from registration |
| Meta review for MARKETING templates | Already approved |
| Display name review | Unknown — manual review in progress |
| Final verification query | 15 minutes |
| **Remaining lead time** | **1–3 days** |

---

## 7. Script Comment Correction

The comment in `field-service/scripts/register-whatsapp-templates.mjs` states:

> *"The 9 templates already APPROVED in en_ZA are NOT re-submitted here"*

This comment is **incorrect** for WABA `104200042667877`. Those 9 templates were absent and have now been registered. The comment should be removed or updated to reflect that all 21 templates are registered on this WABA.
