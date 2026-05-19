# Plug A Pro

WhatsApp-native field service platform for South Africa. Customers book home services via WhatsApp; technicians manage jobs through a lightweight PWA; the platform handles dispatch, invoicing, and payments.

## Apps

| App | Directory | Domain | Purpose |
|-----|-----------|--------|---------|
| Field Service | `field-service/` | `app.plugapro.co.za` | 3-role PWA (customer, technician, admin) + WhatsApp bot |
| Marketing | `marketing/` | `plugapro.co.za` | Marketing site, waitlist, AI chat, blog |

## Quick start

```bash
# Field service app
cd field-service
cp .env.local.example .env.local
# Fill in credentials — see comments in .env.local.example
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate dev --name init
pnpm exec prisma db seed
pnpm dev
# → http://localhost:3000

# Marketing site
cd marketing
cp .env.local.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL
# Run: vercel link → enable AI Gateway → vercel env pull (provisions VERCEL_OIDC_TOKEN)
pnpm install
pnpm dev
# → http://localhost:3001
```

## Tech stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Auth**: Supabase Auth (phone OTP for customers, email+password for technicians/admins)
- **Database**: Prisma + Supabase Postgres
- **Payments**: Peach Payments (South Africa)
- **Messaging**: WhatsApp Business Platform (Meta Cloud API)
- **Push**: Web Push / VAPID (technician job alerts)
- **Storage**: Vercel Blob (job photos, invoices)
- **UI**: shadcn/ui + Tailwind CSS 4 + Geist

## Deployment

Each app deploys to its own Vercel project:

```bash
# Field service
cd field-service && vercel link && vercel env pull && vercel deploy

# Marketing
cd marketing && vercel link && vercel env pull && vercel deploy
```

## Documentation

- `docs/` — master solution document and WhatsApp user journey
- `field-service/docs/whatsapp-setup.md` — WhatsApp Business Platform setup guide
- `field-service/.env.local.example` — all required environment variables

## Follow-ups before go-live

- [ ] Replace WhatsApp placeholder number (+27100000000) in both apps
- [ ] Create PWA icons (192x192 and 512x512 PNG) in `field-service/public/icons/`
- [ ] Create OG image in `field-service/public/og.png`
- [ ] Register WhatsApp message templates in Meta Business Manager
- [ ] Provision Supabase project and run database migrations
- [ ] Configure custom domains in Vercel
