# WhatsApp Ad CTA — Deep-Link Prefilled Message

When boosting a Plug A Pro provider-acquisition post on Facebook/Instagram with
the "Send WhatsApp message" CTA, paste the prefilled-message string below.

The bot's deep-link matcher recognises this token, skips the generic welcome
menu, and routes the user directly into the registration flow.

## Token

```
Register provider
```

Casing and trailing emoji are tolerated. Do not change the wording without
updating `DEEPLINK_TOKENS` in `lib/whatsapp-deeplinks.ts`.

## How to verify it's working

1. Click your live boost or test ad → "Send Message" → WhatsApp opens with the
   prefilled text "Register provider".
2. Send the message.
3. The bot should reply with the registration name prompt (Workstream A copy),
   NOT the generic welcome menu.

If the bot replies with the welcome menu instead, check:

- `whatsapp.registration.deeplink` flag is enabled in production.
- The prefilled message contains the exact token "Register provider".
