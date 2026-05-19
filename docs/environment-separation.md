# Plug-A-Pro Environment Separation

## Rules

- Production and staging secrets must live in Vercel, Supabase, Meta, payment-provider dashboards, or the approved password manager.
- Real `.env`, `.env.local`, `.env.production.local`, `.env.vercel.local`, and `.vercel/.env*` files must not be stored in Dropbox-synced project paths.
- Local development must use synthetic or sandbox values unless a production incident runbook explicitly requires otherwise.
- Do not run `vercel env pull` into this repository path. Pull into an unsynced working directory or copy only non-secret example keys into `.env.local.example`.
- Never commit service-role keys, OTP/static secrets, webhook secrets, VAPID private keys, Blob tokens, WhatsApp access tokens, database URLs, or payment credentials.

## Local Development

Use `field-service/.env.local.example` and `marketing/.env.local.example` as key catalogs only. Store actual values outside the synced workspace and load them through the shell, a password-manager CLI, or an unsynced local checkout.

## Rotation Guidance

If a real secret has been present in a synced workspace, rotate it from the source system. Rotate these categories first:

1. Supabase database URLs and service-role keys.
2. WhatsApp access token, app secret, verify token, and phone-number credentials.
3. Payment provider credentials and webhook secrets.
4. Vercel Blob token and deployment automation tokens.
5. VAPID private key, cron secret, OTP/static test secrets, and admin bootstrap credentials.

Do not paste secret values into tickets, OpenBrain, pull requests, logs, or chat. Record only the secret category, rotation status, owner, and date.

## Closure Evidence

A secret-remediation task can be closed only when:

- A tracked-file check confirms no real env files are committed.
- A workspace check confirms no real secret-bearing env files remain under the synced project path.
- Rotation status is recorded for every secret category that may have synced.
- The app can build/start using the approved environment source.
