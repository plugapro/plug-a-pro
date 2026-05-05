# Plug A Pro — Field Service App

WhatsApp-native field service platform for South Africa. Three-role PWA (customer, technician, admin) with full job lifecycle management, WhatsApp bot integration, and Peach Payments.

**Production URL:** `https://app.plugapro.co.za`

---

## Quick start

### 1. Environment setup

```bash
cp .env.local.example .env.local
# Fill in all values — see comments in .env.local.example
```

Required credentials:
- **Supabase**: new project → copy URL, anon key, service role key, database URLs
- **WhatsApp**: Meta Business Account → WhatsApp product → Phone Number ID + access token
- **Peach Payments**: sandbox account (`PEACH_TEST_MODE=true` for local dev)
- **Vercel**: `vercel link` → `vercel env pull` (provisions OIDC token)
- **Google Maps**: Maps Embed API + Places API + Geocoding API keys

### 2. Install and set up database

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed          # loads Plug A Pro demo data
```

### 3. Run locally

```bash
npm run dev
# → http://localhost:3000
```

Three interfaces:
- `/` → Customer service catalogue and booking (phone OTP)
- `/technician` → Technician job app (email/password)
- `/admin` → Admin console (email/password)

---

## Architecture

```
field-service/
├── app/
│   ├── (customer)/     # Customer PWA — browse, book, track, approve extras
│   ├── (technician)/   # Technician PWA — today's jobs, status, proof
│   ├── (admin)/        # Admin console — dispatch, config, reporting
│   ├── (auth)/         # Sign-in, sign-up, OTP
│   └── api/webhooks/   # WhatsApp + payment webhook receivers
├── prisma/
│   └── schema.prisma   # Full data model (19 models, 10 enums)
├── lib/
│   ├── auth.ts         # Supabase Auth + role guards
│   ├── db.ts           # Prisma client singleton
│   ├── jobs.ts         # Job lifecycle state machine + side effects
│   ├── metadata.ts     # Plug A Pro config (name, URL, accent, WhatsApp#)
│   ├── messaging-templates.ts  # WhatsApp template registry (9 templates)
│   ├── payments.ts     # PSP abstraction (Peach Payments)
│   ├── slotting.ts     # Availability engine
│   ├── storage.ts      # Vercel Blob helpers (job photos, quotes)
│   └── whatsapp*.ts    # Meta Cloud API client + bot + flows
├── components/
│   ├── customer/       # Customer-facing UI components
│   ├── technician/     # Field worker UI components
│   ├── admin/          # Admin console components
│   └── shared/         # StatusBadge, Timeline, WhatsAppButton
└── proxy.ts            # Role-based routing middleware
```

---

## Role model

| Role | Access | Auth method |
|------|--------|-------------|
| `customer` | Own bookings, extra work approvals | Phone OTP (no forced login to browse) |
| `technician` | Assigned jobs only | Email/password, persistent session |
| `admin` | Full business operations | Email/password |
| `owner` | All admin + billing + user management | Email/password + MFA |

---

## Job state machine

```
ASSIGNED → EN_ROUTE → ARRIVED → STARTED → COMPLETED
                             ↘ PAUSED → STARTED
                             ↘ AWAITING_APPROVAL → STARTED
                                                 → COMPLETED
                             ↘ FAILED → CALLBACK_REQUIRED → ASSIGNED
```

Every status change creates a `JobStatusEvent` (immutable audit trail).

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Generate Prisma client + Next.js build |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:migrate:prod` | Deploy migrations (production) |
| `npm run db:seed` | Seed Plug A Pro demo data |
| `npm run db:studio` | Open Prisma Studio |

---

## WhatsApp setup

See `docs/whatsapp-setup.md` for the complete step-by-step guide covering:
- Meta Developer account and WhatsApp product setup
- All 9 message template registrations (with exact body text)
- Webhook configuration and verification
- Testing before go-live

---

## Deployment

```bash
vercel link        # Connect to Vercel project (plug-a-pro-app)
vercel env pull    # Pull credentials (provisions OIDC for AI Gateway)
vercel deploy      # Preview deployment
vercel --prod      # Production deployment
```

Database migrations in production:
```bash
npm run db:migrate:prod
```

---

## Before go-live checklist

- [ ] Replace WhatsApp placeholder number in `lib/metadata.ts` (`whatsappNumber`)
- [ ] Create PWA icons: `public/icons/icon-192.png` and `public/icons/icon-512.png`
- [ ] Create OG image: `public/og.png` (1200x630px)
- [ ] Register 9 WhatsApp message templates in Meta Business Manager
- [ ] Update `lib/messaging-templates.ts` with approved template names
- [ ] Set `PEACH_TEST_MODE=false` in production env
- [ ] Configure custom domain `app.plugapro.co.za` in Vercel
