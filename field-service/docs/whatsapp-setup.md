# WhatsApp Business Platform — Setup Guide

Complete setup for the Meta WhatsApp Cloud API integration.
Estimated time: **45–90 minutes** (plus 24–72h template review time).

---

## Pre-requisites

- A Facebook/Meta account (personal is fine — you'll create a business account)
- A phone number to register as your WhatsApp Business number
  - Must not be registered on personal WhatsApp (use a new SIM or a VoIP number)
  - South Africa: any +27 mobile or landline number works
- Your app deployed to a public HTTPS URL (for webhook verification)
  - You can use a Vercel preview URL during testing

---

## Step 1 — Meta Developer Account & App

### 1.1 Create a Meta Developer account

1. Go to **https://developers.facebook.com**
2. Sign in with your Facebook account
3. Click **Get Started** → accept the terms → verify your email if prompted

### 1.2 Create a Business Portfolio (Meta Business Manager)

1. Go to **https://business.facebook.com**
2. Click **Create account**
3. Fill in:
   - **Business name**: Plug a Pro (or your venture name)
   - **Your name**: your name
   - **Business email**: your business email
4. Verify your email

### 1.3 Create a Developer App

1. Go to **https://developers.facebook.com/apps**
2. Click **Create App**
3. Select **Other** → click **Next**
4. Select **Business** → click **Next**
5. Fill in:
   - **App name**: `Plug a Pro` (or your venture name)
   - **App contact email**: your email
   - **Business portfolio**: select the one you just created
6. Click **Create App**

---

## Step 2 — Add WhatsApp Product & Get Credentials

### 2.1 Add WhatsApp to your app

1. On your app dashboard, find **WhatsApp** in the product list
2. Click **Set up** next to WhatsApp
3. You'll land on the **WhatsApp > Getting Started** page

### 2.2 Note your Phone Number ID and WABA ID

On the Getting Started page:

- **Phone Number ID** — a long number like `123456789012345`
  - This is `WHATSAPP_PHONE_NUMBER_ID` in your env vars
- **WhatsApp Business Account ID (WABA ID)** — needed for template management
  - Found at the top of the Getting Started page, or under **WhatsApp > Configuration**

> At this point Meta gives you a **test number** (shared Sandbox). This is fine for development.
> You'll add your real business number in Step 6.

### 2.3 Generate a System User Token (permanent access token)

The temporary token on the Getting Started page expires in 24h. Get a permanent one:

1. Go to **Meta Business Settings** → https://business.facebook.com/settings
2. In the left menu: **Users > System Users**
3. Click **Add** → name it `Plug a Pro API` → set role to **Admin**
4. Click **Generate New Token**
5. Select your app (the one you just created)
6. Under **Permissions**, enable:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
7. Click **Generate Token** and **copy it immediately** — it won't be shown again
8. This is your `WHATSAPP_ACCESS_TOKEN`

---

## Step 3 — Register Message Templates

Templates must be approved before they can be sent to customers. Register all 9 templates below.

### How to create a template

1. Go to **Meta Business Suite** → https://business.facebook.com
2. Left menu: **All tools > WhatsApp Manager**
3. Select your WhatsApp Business Account
4. Left menu: **Account tools > Message templates**
5. Click **Create template**

### Template settings for all templates

Use these settings for every template:
- **Category**: `Utility` (transactional notifications — fastest approval)
- **Language**: `English (ZA)`
- **Header**: *(leave empty unless specified)*
- **Footer**: *(leave empty)*
- **Buttons**: *(leave empty unless specified)*

---

### Template 1 — `booking_confirmation`

| Field | Value |
|-------|-------|
| Template name | `booking_confirmation` |
| Category | Utility |
| Language | English (ZA) |

**Body text** (copy-paste exactly):
```
Hi {{1}}, your booking for {{2}} has been confirmed for {{3}}. Track your appointment and view details here: {{4}}

If you need to reschedule or cancel, use the link above. Thank you for choosing us!
```

**Variable samples** (required by Meta during submission):
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `Geyser Replacement` |
| `{{3}}` | `Tuesday 8 April, 09:00–12:00` |
| `{{4}}` | `https://plugapro.co.za/bookings/abc123` |

---

### Template 2 — `booking_reminder`

| Field | Value |
|-------|-------|
| Template name | `booking_reminder` |
| Category | Utility |
| Language | English (ZA) |

**Body text**:
```
Hi {{1}}, just a reminder that your {{2}} appointment is scheduled for {{3}}.

Your technician will arrive between {{4}}. View your booking: {{5}}

Reply STOP to unsubscribe from reminders.
```

**Variable samples**:
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `Geyser Replacement` |
| `{{3}}` | `Tuesday 8 April` |
| `{{4}}` | `09:00–12:00` |
| `{{5}}` | `https://plugapro.co.za/bookings/abc123` |

> **Note**: The codebase currently sends 3 variables for this template (customerName, serviceName, scheduledWindow). After registering with 5 variables, update `sendBookingReminder` in `lib/whatsapp.ts` to include `scheduledDate` and `bookingUrl` as separate parameters, or simplify to the 3-variable version below:

**3-variable alternative** (matches current code exactly):
```
Hi {{1}}, just a reminder that your {{2}} appointment is coming up: {{3}}. We look forward to seeing you!

Reply STOP to unsubscribe from reminders.
```
| Variable | Sample |
|----------|--------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `Geyser Replacement` |
| `{{3}}` | `Tuesday 8 April, 09:00–12:00` |

---

### Template 3 — `technician_on_the_way`

| Field | Value |
|-------|-------|
| Template name | `technician_on_the_way` |
| Category | Utility |
| Language | English (ZA) |

**Body text**:
```
Hi {{1}}, great news! {{2}} is on their way to you and should arrive in {{3}}.

Please make sure someone is available to let them in. Thank you!
```

**Variable samples**:
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `James` |
| `{{3}}` | `approximately 20 minutes` |

---

### Template 4 — `technician_arrived`

| Field | Value |
|-------|-------|
| Template name | `technician_arrived` |
| Category | Utility |
| Language | English (ZA) |

**Body text**:
```
Hi {{1}}, {{2}} has arrived at your location and is ready to begin work.

Please let them in at your earliest convenience.
```

**Variable samples**:
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `James` |

---

### Template 5 — `extra_work_approval`

| Field | Value |
|-------|-------|
| Template name | `extra_work_approval` |
| Category | Utility |
| Language | English (ZA) |

**Body text**:
```
Hi {{1}}, your technician has identified additional work that needs to be done:

*{{2}}*
Amount: {{3}}

Please review and approve or decline this additional work here: {{4}}

Work will only proceed once you approve.
```

**Variable samples**:
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `Replace isolator valve (corroded)` |
| `{{3}}` | `R 350.00` |
| `{{4}}` | `https://plugapro.co.za/approve/xyz789` |

---

### Template 6 — `job_completed`

| Field | Value |
|-------|-------|
| Template name | `job_completed` |
| Category | Utility |
| Language | English (ZA) |

**Body text**:
```
Hi {{1}}, your job has been completed successfully! 🎉

View and download your invoice here: {{2}}

Thank you for choosing us. We hope to see you again soon!
```

**Variable samples**:
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `https://plugapro.co.za/bookings/abc123/invoice` |

---

### Template 7 — `follow_up`

| Field | Value |
|-------|-------|
| Template name | `follow_up` |
| Category | Utility |
| Language | English (ZA) |

**Body text**:
```
Hi {{1}}, we hope your {{2}} went smoothly!

We'd love to hear your feedback. It only takes 30 seconds: {{3}}

Your review helps us improve and helps other customers find trusted professionals.
```

**Variable samples**:
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `Geyser Replacement` |
| `{{3}}` | `https://plugapro.co.za/rate/abc123` |

> **Note**: The current `sendFollowUp` in `lib/whatsapp.ts` sends 2 variables (customerName, ratingUrl).
> Either use the 2-variable version below, or add `serviceName` to the function call.

**2-variable alternative** (matches current code exactly):
```
Hi {{1}}, we hope your recent service went smoothly!

We'd love to hear your feedback — it only takes 30 seconds: {{2}}

Thank you for choosing us!
```

---

### Template 8 — `quote_ready`

| Field | Value |
|-------|-------|
| Template name | `quote_ready` |
| Category | Utility |
| Language | English (ZA) |

**Body text**:
```
Hi {{1}}, your quote for {{2}} is ready!

Quoted price: *{{3}}*

View the full quote and accept it here: {{4}}

This quote is valid for 7 days.
```

**Variable samples**:
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `Electrical Rewiring` |
| `{{3}}` | `R 2,500.00` |
| `{{4}}` | `https://plugapro.co.za/quotes/qrt456` |

---

### Template 9 — `booking_cancelled`

| Field | Value |
|-------|-------|
| Template name | `booking_cancelled` |
| Category | Utility |
| Language | English (ZA) |

**Body text**:
```
Hi {{1}}, your {{2}} booking has been cancelled.

{{3}}

To make a new booking, visit us at plugapro.co.za or reply *Hi* to this message.
```

**Variable samples**:
| Variable | Sample value |
|----------|-------------|
| `{{1}}` | `Sarah` |
| `{{2}}` | `Geyser Replacement` |
| `{{3}}` | `A full refund will be processed within 3–5 business days.` |

> The third variable is a refund note. When there is no refund (e.g., cancelled before payment), pass an empty string `""` or a generic message like `"No payment was taken."`.

---

## Step 4 — Configure the Webhook

### 4.1 Set your Verify Token

Choose a random secret string, e.g. `plugapro-webhook-2024-abc123`.
This goes in your env as `WHATSAPP_VERIFY_TOKEN`.

### 4.2 Register the webhook in Meta

1. Go to your app dashboard → **WhatsApp > Configuration**
2. Under **Webhook**, click **Edit**
3. Fill in:
   - **Callback URL**: `https://your-domain.vercel.app/api/webhooks/whatsapp`
   - **Verify token**: the string you chose above
4. Click **Verify and save**
   - Meta will send a GET request to your URL — the app must be deployed for this to work
   - If verification fails, check that `WHATSAPP_VERIFY_TOKEN` is set in your Vercel env vars

### 4.3 Subscribe to webhook fields

After verification, subscribe to these fields:
- ✅ `messages` — inbound customer messages
- ✅ `message_deliveries` — delivery receipts
- ✅ `message_reads` — read receipts

Click **Done**.

---

## Step 5 — Environment Variables

Add these to your Vercel project (Settings → Environment Variables) and to `.env.local` for local dev:

```bash
# WhatsApp Cloud API credentials
WHATSAPP_ACCESS_TOKEN=your_system_user_token_from_step_2
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_from_step_2
WHATSAPP_VERIFY_TOKEN=your_chosen_verify_token_from_step_4

# Optional: admin notifications for new technician applications
ADMIN_WHATSAPP_NUMBER=+27600000000   # your WhatsApp number in E.164 format
```

For local development, add to `.env.local`:
```bash
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
```

---

## Step 6 — Add Your Production Phone Number

> Do this when you're ready to go live. The test number works fine for development.

### 6.1 Add the phone number

1. In WhatsApp Manager → **Phone numbers**
2. Click **Add phone number**
3. Enter your business phone number (+27...)
4. Verify it via SMS or voice call

### 6.2 Update the env var

Once your production number is added, Meta assigns it a new Phone Number ID.
Update `WHATSAPP_PHONE_NUMBER_ID` in Vercel to the new ID.

### 6.3 Submit for Business Verification (required for high volume)

For sending to numbers outside your test contacts at scale:
1. Meta Business Suite → **Security Centre**
2. Click **Start verification** under Business Verification
3. Submit business documents (company registration, address proof)
4. Approval takes 2–5 business days

---

## Step 7 — Testing

### Test the webhook manually

```bash
# Test the GET challenge (replace with your actual URL and token)
curl "https://your-domain.vercel.app/api/webhooks/whatsapp\
?hub.mode=subscribe\
&hub.verify_token=your_verify_token\
&hub.challenge=test123"
# Expected response: test123
```

### Send a test message via Meta

1. WhatsApp Manager → Getting Started page
2. Under **Send and receive messages**, enter a recipient phone number
3. Click **Send message** — this uses the test number

### Test the bot conversation

Send "Hi" to your WhatsApp number — the bot should respond with the main menu.

### Check message logs

In your admin console: **Messages** tab shows all sent templates with delivery/read status.

---

## Step 8 — Template Approval Timeline

After submitting templates:
- **First review**: 24–72 hours
- **Subsequent reviews** (after edits): another 24–72 hours
- **Auto-approved**: templates are sometimes approved within minutes if they match Meta's patterns

While waiting for template approval, the bot (inbound/outbound free-text within 24h windows) works immediately.

### If a template is rejected

Common reasons and fixes:
| Rejection reason | Fix |
|-----------------|-----|
| "Variable format inconsistent" | Make sure all variables are `{{1}}`, `{{2}}` etc. with no spaces inside |
| "Category mismatch" | Change to `Utility` for transactional; `Marketing` for promotional |
| "Contains promotional content" | Remove pricing incentives, discount language from Utility templates |
| "URL variable in body" | Move the URL to a **Call to Action button** instead (optional) |

---

## Checklist

Use this to confirm setup is complete before launch:

- [ ] Meta Developer App created
- [ ] System User token generated with `whatsapp_business_messaging` + `whatsapp_business_management` permissions
- [ ] `WHATSAPP_ACCESS_TOKEN` set in Vercel env vars
- [ ] `WHATSAPP_PHONE_NUMBER_ID` set in Vercel env vars
- [ ] `WHATSAPP_VERIFY_TOKEN` set in Vercel env vars
- [ ] All 9 templates registered in WhatsApp Manager
- [ ] All 9 templates approved by Meta
- [ ] Webhook URL verified in Meta dashboard
- [ ] Webhook subscribed to: `messages`, `message_deliveries`, `message_reads`
- [ ] Test message received on test number
- [ ] Bot responds to "Hi" with main menu
- [ ] Production phone number added (go-live)
- [ ] Business verification submitted (high volume)
