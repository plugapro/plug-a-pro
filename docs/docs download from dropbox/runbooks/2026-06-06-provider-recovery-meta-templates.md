# Provider Recovery Meta Templates - 2026-06-06

## Scope

Submit these five WhatsApp Business templates before enabling `whatsapp.recovery.template_send`.

All templates use:

- Category: `UTILITY`
- Language: `en_ZA`
- Body variables: one text variable, `{{1}}`
- Buttons: none

`{{1}}` is the provider first name when safe, otherwise `there`.

## Templates

### `provider_recovery_evidence`

Body:

```text
Hi {{1}}, this is Plug A Pro. You're almost done with your provider registration. We still need your work photo or proof of service so we can finish reviewing your profile. Please reply here when you're ready and we'll help you complete it.
```

### `provider_recovery_started_blocked`

Body:

```text
Hi {{1}}, this is Plug A Pro. I can see you started your provider registration but didn't finish it. Please reply with your full name, the service you offer, and the area where you work, and we'll help you complete it.
```

### `provider_recovery_no_name`

Body:

```text
Hi {{1}}, this is Plug A Pro. I noticed you tapped register but didn't complete your name. To continue your provider registration, please reply with your full name.
```

### `provider_recovery_welcome_idle`

Body:

```text
Hi {{1}}, this is Plug A Pro. We help service providers get matched with job requests. To register as a provider, please reply REGISTER and we will help you complete your profile.
```

### `provider_recovery_flow_conflict`

Body:

```text
Hi {{1}}, this is Plug A Pro. It looks like your WhatsApp session may have gone into the wrong flow. Please reply 1 to register as a provider, or 2 to request a service from a provider.
```

## Rollout Check

1. Submit and wait for Meta approval for all five templates.
2. Seed the feature flag row disabled with `pnpm exec tsx scripts/seed-flags.ts --flag=whatsapp.recovery.template_send`.
3. Confirm the admin recovery queue still shows outside-window rows as queued while the flag is disabled.
4. Enable the flag only after approval:

```bash
pnpm exec tsx scripts/seed-flags.ts --flag=whatsapp.recovery.template_send --enable
```

5. Send one operator-triggered outside-window recovery row first and verify the banner says `Recovery template sent successfully outside the 23h WhatsApp session window.`
