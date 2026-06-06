# Plug A Pro — Claude Code Context

This file is the Session 0 audit for the current workspace.

## Scope
- Monorepo root: `/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro`
- Admin app: `field-service/`
- Marketing site: `marketing/`
- Prompt-pack companion docs currently live in `outputs/`, not `reference/`:
  - `outputs/PlugAPro-CRUD-Implementation-Plan.md`
  - `outputs/PlugAPro-CRUD-Capability-Audit.md`
  - `outputs/plugapro-admin-scaffold/`
- If later sessions assume `reference/plugapro-admin-scaffold/`, either move/copy the scaffold there first or adjust those prompts to use `outputs/plugapro-admin-scaffold/`.

## Conventions

### Next.js
- Version: `next@^16.2.1`
- Router: App Router
- App root: `field-service/app`
- Admin route group: `field-service/app/(admin)`
- Admin layout: `field-service/app/(admin)/layout.tsx`
- Admin domain rewrite/protection lives in `field-service/proxy.ts`

### `/admin` route inventory
- `/admin` → `field-service/app/(admin)/admin/page.tsx`
- `/admin/applications` → `field-service/app/(admin)/admin/applications/page.tsx`
- `/admin/bookings` → `field-service/app/(admin)/admin/bookings/page.tsx`
- `/admin/bookings/[id]` → `field-service/app/(admin)/admin/bookings/[id]/page.tsx`
- `/admin/categories` → `field-service/app/(admin)/admin/categories/page.tsx`
- `/admin/customers` → `field-service/app/(admin)/admin/customers/page.tsx`
- `/admin/customers/[id]` → `field-service/app/(admin)/admin/customers/[id]/page.tsx`
- `/admin/dispatch` → `field-service/app/(admin)/admin/dispatch/page.tsx`
- `/admin/disputes` → `field-service/app/(admin)/admin/disputes/page.tsx`
- `/admin/field-exceptions` → `field-service/app/(admin)/admin/field-exceptions/page.tsx`
- `/admin/flows` → `field-service/app/(admin)/admin/flows/page.tsx`
- `/admin/locations` → `field-service/app/(admin)/admin/locations/page.tsx`
- `/admin/matches` → `field-service/app/(admin)/admin/matches/page.tsx`
- `/admin/messages` → `field-service/app/(admin)/admin/messages/page.tsx`
- `/admin/payments` → `field-service/app/(admin)/admin/payments/page.tsx`
- `/admin/providers` → `field-service/app/(admin)/admin/providers/page.tsx`
- `/admin/providers/[id]` → `field-service/app/(admin)/admin/providers/[id]/page.tsx`
- `/admin/quotes` → `field-service/app/(admin)/admin/quotes/page.tsx`
- `/admin/reports` → `field-service/app/(admin)/admin/reports/page.tsx`
- `/admin/services` → `field-service/app/(admin)/admin/services/page.tsx`
- `/admin/settings` → `field-service/app/(admin)/admin/settings/page.tsx`
- `/admin/team` → `field-service/app/(admin)/admin/team/page.tsx`
- `/admin/technicians` → `field-service/app/(admin)/admin/technicians/page.tsx`
- `/admin/technicians/[id]` → `field-service/app/(admin)/admin/technicians/[id]/page.tsx`
- `/admin/validation` → `field-service/app/(admin)/admin/validation/page.tsx`
- `/admin/vouchers` → `field-service/app/(admin)/admin/vouchers/page.tsx`

### Provider routes
- `/provider/signup` → `field-service/app/(provider)/provider/signup/page.tsx` (anonymous, token-gated by ProviderResumeToken)
- `/provider/signup/confirmation` → `field-service/app/(provider)/provider/signup/confirmation/page.tsx`

### Important route aliases
- `/admin/providers` is a thin alias that re-exports `../technicians/page.tsx`
- `/admin/providers/[id]` is a thin alias that re-exports `../../technicians/[id]/page.tsx`
- If a prompt says “edit providers page”, inspect `providers/*` first, then confirm whether the real implementation is in `technicians/*`

### Error boundaries already present
- Admin-wide: `field-service/app/(admin)/admin/error.tsx`
- Group-level: `field-service/app/(admin)/error.tsx`
- Detail pages:
  - `field-service/app/(admin)/admin/providers/[id]/error.tsx`
  - `field-service/app/(admin)/admin/bookings/[id]/error.tsx`
  - `field-service/app/(admin)/admin/customers/[id]/error.tsx`
- Observability in these boundaries is currently `console.error(...)`; no Sentry integration was found

### Server actions
- Mixed conventions are in use.
- Newer admin CRUD-style modules use co-located `actions.ts` files:
  - `field-service/app/(admin)/admin/locations/actions.ts`
  - `field-service/app/(admin)/admin/customers/actions.ts`
  - `field-service/app/(admin)/admin/providers/actions.ts`
  - `field-service/app/(admin)/admin/team/actions.ts`
- Older pages still embed inline server actions directly inside `page.tsx` with `'use server'`
- Newer action naming pattern:
  - typed action: `createLocationNodeAction`, `blockCustomerAction`, `inviteAdminAction`
  - form wrapper: `createLocationNodeFromFormAction`, `blockCustomerFromFormAction`, `inviteAdminFromFormAction`
- If adding new admin mutations, prefer the co-located `actions.ts` pattern over inline page actions unless there is a strong reason not to

### Prisma
- Schema path: `field-service/prisma/schema.prisma`
- Prisma singleton: `field-service/lib/db.ts`

### Current Prisma model map vs plan wording
- Plan says `Application`; actual Prisma model is `ProviderApplication`
- Plan says `Location`; actual Prisma model is `LocationNode`
- Plan says `Category`; there is no Prisma `Category` model right now
- Category data is currently represented as string slugs on domain models such as `JobRequest.category` and `Provider.skills`

### Requested model inventory
- `Customer`
  - Fields: `id`, `userId`, `phone`, `email`, `name`, `notes`, `active`, `createdAt`, `updatedAt`, `whatsappServiceOptIn`, `whatsappMarketingOptIn`, `whatsappMarketingOptInAt`, `whatsappMarketingOptOutAt`, `whatsappMarketingSource`, `lastWhatsappPrefSyncAt`, `address`, `isBlocked`, `blockedReason`, `blockedAt`, `suspendedUntil`, `suspendedReason`, `internalFlags`, `marketingOptIn`, `serviceOptIn`, `archivedAt`, `archiveReason`, `channel`
  - Relations: `addresses`, `jobRequests`, `ratings`, `messages`, `whatsappPreferenceLogs`, `customerNotes`
- `Provider`
  - Fields: `id`, `userId`, `phone`, `email`, `name`, `bio`, `experience`, `skills`, `serviceAreas`, `equipmentTags`, `vehicleTypes`, `evidenceNote`, `portfolioUrls`, `active`, `availableNow`, `verified`, `averageRating`, `reliabilityScore`, `completedJobsCount`, `onTimeRate`, `acceptanceRate`, `complaintCount`, `complaintRate`, `providerCancellationCount`, `cancellationRate`, `lateArrivalCount`, `punctualityScore`, `maxTravelMinutes`, `lastKnownLat`, `lastKnownLng`, `lastKnownLocationLabel`, `lastKnownLocationAt`, `avatarUrl`, `whatsappMarketingOptIn`, `createdAt`, `updatedAt`, `status`, `kycStatus`, `payoutVerifiedAt`, `suspendedUntil`, `suspendedReason`, `strikes`, `archivedAt`, `archiveReason`
  - Relations include: `schedule`, `technicianSkills`, `technicianCertifications`, `technicianServiceAreas`, `technicianAvailability`, `scheduleItems`, `leads`, `matches`, `jobs`, `reviews`, `pushSubscriptions`, `applications`, `preferredByRequests`, `assignmentHolds`, `matchAttempts`, `selectedDispatchDecisions`, `providerNotes`, `adminCertifications`, `equipment`
- `Booking`
  - Fields: `id`, `matchId`, `quoteId`, `status`, `scheduledDate`, `scheduledWindow`, `scheduledStartAt`, `scheduledEndAt`, `notes`, `cancelReason`, `rescheduleCount`, `createdAt`, `updatedAt`
  - Relations: `match`, `quote`, `job`, `payment`, `invoice`, `messages`, `scheduleItems`
- `JobRequest`
  - Fields: `id`, `customerId`, `addressId`, `category`, `title`, `description`, `requestedWindowStart`, `requestedWindowEnd`, `requestedArrivalLatest`, `estimatedDurationMinutes`, `requiredSkillTags`, `requiredCertificationCodes`, `requiredEquipmentTags`, `requiredVehicleTypes`, `preferredProviderId`, `assignmentMode`, `customerAcceptedAmount`, `customerAcceptedScope`, `autoCreateBookingOnAssignment`, `customerAccessToken`, `customerAccessTokenExpiresAt`, `customerAccessTokenRevokedAt`, `latestDispatchDecisionId`, `status`, `expiresAt`, `createdAt`, `updatedAt`
  - Relations: `customer`, `address`, `preferredProvider`, `attachments`, `leads`, `match`, `scheduleItems`, `matchAttempts`, `assignmentHolds`, `dispatchDecisions`
- `Match`
  - Fields: `id`, `jobRequestId`, `providerId`, `status`, `inspectionNeeded`, `createdAt`, `updatedAt`
  - Relations: `jobRequest`, `provider`, `inspectionSlots`, `quotes`, `booking`
- `Quote`
  - Fields: `id`, `matchId`, `amount`, `labourCost`, `materialsCost`, `estimatedHours`, `description`, `validUntil`, `preferredDate`, `postInspection`, `approvalToken`, `status`, `approvedAt`, `declinedAt`, `notes`, `createdAt`, `updatedAt`
  - Relations: `match`, `booking`
- `Payment`
  - Fields: `id`, `bookingId`, `status`, `collectionMode`, `amount`, `currency`, `pspProvider`, `pspReference`, `pspCheckoutId`, `checkoutUrl`, `paidAt`, `failureReason`, `refundedAmount`, `refundedAt`, `metadata`, `createdAt`, `updatedAt`
  - Relations: `booking`
- `Dispute`
  - Fields: `id`, `jobId`, `raisedById`, `raisedByRole`, `reason`, `status`, `resolution`, `resolvedAt`, `resolvedById`, `createdAt`, `updatedAt`
  - Note: there is no relation declared from `Dispute` to `Job` in the current schema block
- `Application`
  - Not present as `Application`
  - Actual model: `ProviderApplication`
  - Fields: `id`, `providerId`, `phone`, `name`, `skills`, `serviceAreas`, `experience`, `availability`, `evidenceNote`, `idNumber`, `status`, `notes`, `reviewedAt`, `reviewedById`, `submittedAt`, `updatedAt`
- `Location`
  - Not present as `Location`
  - Actual model: `LocationNode`
  - Fields: `id`, `nodeType`, `slug`, `label`, `parentId`, `lat`, `lng`, `radiusKm`, `postalCode`, `provinceKey`, `cityKey`, `regionKey`, `active`, `createdAt`, `updatedAt`
  - Relations: `parent`, `children`, `technicianServiceAreas`, `addresses`
- `Category`
  - No Prisma model currently exists
  - Current category storage is string-based
    - `JobRequest.category: String`
    - `Provider.skills: String[]`
    - `ServiceAreaWaitlist.category: String?`

### Audit / event / history / log models already present
- `AuditLog`
  - Fields: `id`, `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `before`, `after`, `ipAddress`, `userAgent`, `timestamp`
- `AdminAuditEvent`
  - Fields: `id`, `adminId`, `action`, `entityType`, `entityId`, `before`, `after`, `metadata`, `ipAddress`, `userAgent`, `timestamp`
- `WhatsappPreferenceLog`
  - Fields: `id`, `customerId`, `field`, `oldValue`, `newValue`, `source`, `actorId`, `note`, `createdAt`
- `JobStatusEvent`
  - Fields: `id`, `jobId`, `fromStatus`, `toStatus`, `actorId`, `actorRole`, `notes`, `timestamp`
- `MessageEvent` also exists for outbound/inbound message state

### Feature flags and admin models
- `FeatureFlag` table already exists: `key`, `enabled`, `enabledForUsers`, `description`, `updatedAt`
- `AdminUser` already exists: `id`, `userId`, `email`, `name`, `role`, `active`, `invitedAt`, `invitedById`, `acceptedAt`, `createdAt`, `updatedAt`
- Role enum already exists: `OPS`, `FINANCE`, `TRUST`, `ADMIN`, `OWNER`
- Important: current `AdminUser` is single-role (`role: Role`), not multi-role (`roles: Role[]`)

### Auth
- Auth provider: Supabase Auth
- Session cookie: HttpOnly `sb-access-token`, written by `field-service/app/api/auth/session/route.ts`
- Session reader: `field-service/lib/auth.ts#getSession()`
- Server-side route guards:
  - `requireAdmin()`
  - `requireAdminApi()`
  - `requireProvider()`
  - `getCustomerSession()`
- Request-time protection for `/admin` and `/provider` routes is enforced in `field-service/proxy.ts`
- Proxy currently authorizes admin access from Supabase `user_metadata.role` only (`admin` or `owner`)
- `crudAction()` adds a second layer:
  - resolves `AdminUser.role` from DB if present
  - falls back to legacy Supabase `user_metadata.role`
- Current admin provisioning is transitional:
  - legacy source of truth: Supabase user metadata role (`admin` / `owner`)
  - new DB-backed model: `AdminUser`
  - backfill script: `field-service/scripts/backfill-admin-users.ts`

### UI primitives
- Tailwind: Tailwind CSS v4 via `field-service/postcss.config.mjs`
- No `tailwind.config.*` file exists
- Theme tokens and utility layers live in `field-service/app/globals.css`
- Primitive library: shadcn-style setup over Radix
- shadcn config: `field-service/components.json`
  - style: `new-york`
  - icon library: `lucide`
- Installed UI components in `field-service/components/ui/`:
  - `avatar`, `badge`, `button`, `card`, `checkbox`, `dialog`, `dropdown-menu`, `input`, `label`, `otp-input`, `select`, `separator`, `skeleton`, `sonner`, `table`, `tabs`, `textarea`, `tooltip`
- Utility layer:
  - `cn()` in `field-service/lib/utils.ts`
  - `cva` via `class-variance-authority`
- Icons: `lucide-react`

### Forms and validation
- Repo already uses `react-hook-form`
- Repo already uses `zod`
- Repo already uses `@hookform/resolvers/zod`
- Current pattern is mixed:
  - CRUD kit form component uses `react-hook-form` + `zodResolver`
  - admin server actions validate with `z.object(...)`
  - older forms still post raw `FormData` to inline server actions

### Tests
- Unit/integration framework: Vitest
- Config: `field-service/vitest.config.ts`
- Test environment: `node`
- E2E framework: Playwright
- Config: `field-service/playwright.config.ts`
- Smoke suite: `field-service/e2e/smoke.spec.ts`

### CI
- CI workflows live in `.github/workflows/`
- `field-service CI`
  - PRs and pushes run `pnpm lint` and `pnpm test`
  - optional build job runs on push only when repo variable `CI_BUILD_ENABLED == 'true'`
  - smoke job runs on push only when secret `E2E_BASE_URL` is set
- Important:
  - smoke tests do not currently run on PRs by default
  - smoke suite includes admin routes plus client recovery/booking routes; keep route inventory aligned with `field-service/e2e/smoke.spec.ts`

### Feature flags
- Resolution order in `field-service/lib/flags.ts`
  - DB row in `feature_flags`
  - `FEATURE_FLAGS` JSON env var
  - default `false`
- Per-user rollout is supported through `enabledForUsers`
- Seed script: `field-service/scripts/seed-flags.ts`
- Current seeded flags:
  - `admin.crud.locations`
  - `admin.crud.customers`
  - `admin.crud.providers`
  - `admin.users.v2`
  - `admin.vouchers`
  - `admin.applications.resume_link_button`
  - `whatsapp.registration.web_resume`

### Integrations
- Transactional messaging
  - WhatsApp: Meta WhatsApp Cloud API via `field-service/lib/whatsapp.ts` and `field-service/lib/whatsapp-interactive.ts`
  - Admin invite email: Supabase Auth invite emails via `supabase.auth.admin.inviteUserByEmail(...)`
  - No separate SendGrid / Resend / Twilio mail integration was found for admin invites
- PSP
  - payment abstraction: `field-service/lib/payments.ts`
  - default provider: Peach Payments
  - alternate implementation present: PayFast
  - schema/comments also mention Yoco, but current code path defaults to Peach unless `PSP_PROVIDER` changes
- Storage
  - Vercel Blob via `field-service/lib/storage.ts`

## What’s already in place that WS-A/B/C/D/E can build on
- Route-level admin error boundaries already exist
- Post-deploy Playwright smoke suite already exists
- `crudAction()` already exists and already writes `AuditLog` plus `AdminAuditEvent` in the same transaction
- `AdminUser`, `AdminAuditEvent`, `FeatureFlag`, `CustomerNote`, `ProviderNote`, `ProviderCertification`, and `ProviderEquipment` models already exist
- `Customer` and `Provider` already have most WS-B.1 extension fields
- CRUD kit components already exist in `field-service/components/admin/crud/`
- Flag helpers already exist in `field-service/lib/flags.ts`
- Seed and backfill scripts already exist:
  - `field-service/scripts/seed-flags.ts`
  - `field-service/scripts/backfill-admin-users.ts`
- Partial admin CRUD surfaces already exist:
  - Locations: `field-service/app/(admin)/admin/locations/*`
  - Customers: `field-service/app/(admin)/admin/customers/*`
  - Providers/technicians: `field-service/app/(admin)/admin/providers/*` and `technicians/*`
  - Team: `field-service/app/(admin)/admin/team/*`
- Matching tests for certifications/equipment already exist:
  - `field-service/__tests__/lib/matching-cert-equipment.test.ts`

## What’s missing that we’ll introduce
- A repo-wide understanding that this is not a blank slate; later prompts must adapt to the current implementation instead of blindly copying the scaffold
- `reference/plugapro-admin-scaffold/` path in-repo, if you want prompts to work unmodified
- A real Prisma `Category` model if categories are meant to become managed data instead of string slugs
- Category requirement tables such as `CategoryRequiredCertification` and `CategoryRequiredEquipment`; they do not exist yet
- Dedicated `/admin/team/permissions` page; not present in the current route tree
- Multi-role admin users; current schema supports one `role`, not `roles[]`
- OWNER safety invariants in team actions:
  - no “last OWNER” guard found in current action code
  - no self-deactivate / self-revoke guard found in current action code
- Consistent server-action convention across admin routes; legacy pages still use inline `'use server'`
- Observability integration beyond `console.error`
- CI smoke alignment with real route inventory

## House rules
1. Every admin mutation must go through `crudAction()` unless there is a documented exception.
2. No schema drops or renames in feature PRs. Additive migrations only.
3. No hard deletes without `OWNER` role.
4. Every destructive action should use the destructive confirmation pattern.
5. Every admin-facing feature ships behind a flag and is flipped separately.
6. Every PR touching admin flows should keep or extend Playwright smoke coverage.
7. No `as any` without a nearby TODO explaining why it is temporarily required.
8. Detail pages must guard nullable relations; error boundaries are the last line of defence, not the first.
