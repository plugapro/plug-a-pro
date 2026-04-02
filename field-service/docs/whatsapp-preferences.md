# WhatsApp Marketing Preferences

## Overview

Customers control whether they receive promotional WhatsApp messages via:
- The customer PWA (profile page toggle)
- The WhatsApp bot (STOP OFFERS / START OFFERS keywords)
- Admin override (customer detail page)

Lifecycle/utility messages (booking confirmations, reminders, etc.) are always
sent regardless of the marketing preference — they can only be stopped via the
service opt-in flag (`whatsappServiceOptIn`), which defaults to `true` and has
no customer-facing toggle.

---

## Template Categories

Defined in `lib/messaging-templates.ts`. Each template has `category: 'UTILITY' | 'MARKETING'`.

**MARKETING templates** (require explicit opt-in, default blocked):
| Template | Description |
|----------|-------------|
| `booking_cancelled` | Booking cancellation notification |
| `quote_ready` | Quote ready for review |
| `slot_available` | Slot opened in customer's area (Notify Me) |
| `job_offer` | New job offer sent to a provider |
| `technician_welcome` | Provider approval + app link |

**UTILITY templates** (sent by default, blocked only if `whatsappServiceOptIn = false`):
All other templates — booking confirmations, reminders, job status updates, payment notifications, etc.

---

## Data Model

New fields on `Customer`:

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `whatsappServiceOptIn` | `Boolean` | `true` | May receive utility/lifecycle messages |
| `whatsappMarketingOptIn` | `Boolean` | `false` | May receive promotional messages |
| `whatsappMarketingOptInAt` | `DateTime?` | `null` | When they opted in |
| `whatsappMarketingOptOutAt` | `DateTime?` | `null` | When they last opted out |
| `whatsappMarketingSource` | `String?` | `null` | Last change source: `bot` / `pwa` / `admin` / `webhook` / `import` |
| `lastWhatsappPrefSyncAt` | `DateTime?` | `null` | Last time any preference was updated |

Every preference change is written to `WhatsappPreferenceLog` (table: `whatsapp_preference_logs`)
with `field`, `oldValue`, `newValue`, `source`, optional `actorId` (admin user ID), and `note`.

---

## Enforcement

`lib/whatsapp-policy.ts` is the single enforcement gate.

```typescript
import { canSend } from '@/lib/whatsapp-policy'

const check = await canSend(phone, 'booking_cancelled')
if (!check.allowed) {
  // check.reason: 'marketing_opted_out' | 'service_opted_out' | 'customer_not_found' | 'unknown_template' | 'db_error'
  return
}
```

Every customer-facing function in `lib/whatsapp.ts` calls `canSend()` as its first statement.
Phone numbers must be in **E.164 format** (e.g. `+27821234567`).

---

## Opt-Out Flows

### Via WhatsApp Bot

Send any of: `stop offers`, `unsubscribe`, `stop marketing`, `no marketing`, `opt out`, `optout`

Bot replies with confirmation and instructions to re-subscribe.

To re-subscribe: `start offers`, `subscribe`, `start marketing`, `opt in`, `optin`

Note: `stop` alone (without "offers") still resets to the main menu — it does **not** opt out.

### Via Customer PWA

Profile page → "WhatsApp Notifications" card → uncheck "Subscribed to offers".
Toggle calls `PATCH /api/customer/preferences` with `{ whatsappMarketingOptIn: false }`.

### Via Admin

Customer detail page (`/admin/customers/[id]`) → "WhatsApp Preferences" section → click override button.
Calls `applyOptOut(phone, 'admin', { actorId })` via a Next.js server action.

---

## API

### `GET /api/customer/preferences`

Returns current preference state for the authenticated customer.

**Auth:** Customer session required (role: `customer`)

**Response:**
```json
{
  "whatsappServiceOptIn": true,
  "whatsappMarketingOptIn": false,
  "whatsappMarketingOptInAt": null,
  "whatsappMarketingOptOutAt": "2026-04-02T14:00:00.000Z"
}
```

### `PATCH /api/customer/preferences`

**Auth:** Customer session required (role: `customer`)

**Body:**
```json
{ "whatsappMarketingOptIn": true }
```

**Response:** `{ "ok": true }`

---

## Adding New Templates

1. Add entry to `TEMPLATES` in `lib/messaging-templates.ts` with the correct `category`
2. Add send function in `lib/whatsapp.ts` following the existing guard pattern:
   ```typescript
   export async function sendMyTemplate(params: { customerPhone: string; ... }): Promise<void> {
     const check = await canSend(params.customerPhone, 'my_template')
     if (!check.allowed) {
       console.warn(`[whatsapp] blocked ...`)
       return
     }
     // ... sendTemplate call ...
   }
   ```
3. `canSend()` enforces the correct preference automatically based on the template's category

---

## Migration

The migration is at `prisma/migrations/20260402141355_whatsapp_preferences/migration.sql`.

It was generated with `--create-only` and must be applied manually:
```bash
npx prisma migrate deploy
```

Or for local dev (when connected to the Supabase database):
```bash
npx prisma migrate dev
```
