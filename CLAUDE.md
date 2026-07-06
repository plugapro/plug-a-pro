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
- Current platform-state reference (findings register, backlog, SRE scorecard): `docs/audits/platform-audit-2026-07-06/`

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
- `/admin/audit-log` → `field-service/app/(admin)/admin/audit-log/page.tsx`
- `/admin/bookings` → `field-service/app/(admin)/admin/bookings/page.tsx`
- `/admin/bookings/[id]` → `field-service/app/(admin)/admin/bookings/[id]/page.tsx`
- `/admin/breached` → `field-service/app/(admin)/admin/breached/page.tsx`
- `/admin/categories` → `field-service/app/(admin)/admin/categories/page.tsx`
- `/admin/commercial/provider-economics` → `field-service/app/(admin)/admin/commercial/provider-economics/page.tsx`
- `/admin/customers` → `field-service/app/(admin)/admin/customers/page.tsx`
- `/admin/customers/[id]` → `field-service/app/(admin)/admin/customers/[id]/page.tsx`
- `/admin/customers/new` → `field-service/app/(admin)/admin/customers/new/page.tsx`
- `/admin/dispatch` → `field-service/app/(admin)/admin/dispatch/page.tsx`
- `/admin/disputes` → `field-service/app/(admin)/admin/disputes/page.tsx`
- `/admin/invoices` → `field-service/app/(admin)/admin/invoices/page.tsx`
- `/admin/launch-readiness` → `field-service/app/(admin)/admin/launch-readiness/page.tsx`
- `/admin/lead-unlock-disputes` → `field-service/app/(admin)/admin/lead-unlock-disputes/page.tsx`
- `/admin/locations` → `field-service/app/(admin)/admin/locations/page.tsx`
- `/admin/messages` → `field-service/app/(admin)/admin/messages/page.tsx`
- `/admin/nudges` → `field-service/app/(admin)/admin/nudges/page.tsx`
- `/admin/ops-intelligence` → `field-service/app/(admin)/admin/ops-intelligence/page.tsx`
- `/admin/otp-delivery` → `field-service/app/(admin)/admin/otp-delivery/page.tsx`
- `/admin/otp-security` → `field-service/app/(admin)/admin/otp-security/page.tsx`
- `/admin/payments` → `field-service/app/(admin)/admin/payments/page.tsx`
- `/admin/provider-credit-payments` → `field-service/app/(admin)/admin/provider-credit-payments/page.tsx`
- `/admin/provider-credit-payments/[id]` → `field-service/app/(admin)/admin/provider-credit-payments/[id]/page.tsx`
- `/admin/provider-wallets` → `field-service/app/(admin)/admin/provider-wallets/page.tsx`
- `/admin/provider-wallets/[providerId]` → `field-service/app/(admin)/admin/provider-wallets/[providerId]/page.tsx`
- `/admin/providers` → `field-service/app/(admin)/admin/providers/page.tsx`
- `/admin/providers/[id]` → `field-service/app/(admin)/admin/providers/[id]/page.tsx`
- `/admin/providers/new` → `field-service/app/(admin)/admin/providers/new/page.tsx`
- `/admin/quality` → `field-service/app/(admin)/admin/quality/page.tsx`
- `/admin/quotes` → `field-service/app/(admin)/admin/quotes/page.tsx`
- `/admin/reports` → `field-service/app/(admin)/admin/reports/page.tsx`
- `/admin/reports/acquisition` → `field-service/app/(admin)/admin/reports/acquisition/page.tsx`
- `/admin/reports/funnel` → `field-service/app/(admin)/admin/reports/funnel/page.tsx`
- `/admin/reports/kyc-funnel` → `field-service/app/(admin)/admin/reports/kyc-funnel/page.tsx`
- `/admin/services` → `field-service/app/(admin)/admin/services/page.tsx`
- `/admin/settings` → `field-service/app/(admin)/admin/settings/page.tsx`
- `/admin/team` → `field-service/app/(admin)/admin/team/page.tsx`
- `/admin/team/permissions` → `field-service/app/(admin)/admin/team/permissions/page.tsx`
- `/admin/technicians` → `field-service/app/(admin)/admin/technicians/page.tsx`
- `/admin/technicians/[id]` → `field-service/app/(admin)/admin/technicians/[id]/page.tsx`
- `/admin/validation` → `field-service/app/(admin)/admin/validation/page.tsx`
- `/admin/verifications` → `field-service/app/(admin)/admin/verifications/page.tsx`
- `/admin/verifications/[id]` → `field-service/app/(admin)/admin/verifications/[id]/page.tsx`
- `/admin/verifications/vendors` → `field-service/app/(admin)/admin/verifications/vendors/page.tsx`
- `/admin/vouchers` → `field-service/app/(admin)/admin/vouchers/page.tsx`
- Removed routes (do not reference): `/admin/field-exceptions`, `/admin/flows`, `/admin/matches` no longer exist

### Provider routes
- `/provider/signup` → `field-service/app/provider/signup/page.tsx` (anonymous, token-gated by ProviderResumeToken)
- `/provider/signup/confirmation` → `field-service/app/provider/signup/confirmation/page.tsx`

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
- Boundaries also exist for customer (`app/(customer)/*/error.tsx`), provider (`app/(provider)/**/error.tsx`, `app/provider/signup/error.tsx`) and the app root (`app/error.tsx`, `app/global-error.tsx`)
- Observability: Sentry is wired — every `error.tsx` calls `Sentry.captureException(error)`; client init loads via `field-service/instrumentation-client.ts` (Turbopack-compatible; `sentry.client.config.ts` holds the shared init with SA-phone redaction), server errors flow through `onRequestError` in `field-service/instrumentation.ts`, and `apiError()` 5xx envelopes are captured tagged with their `reference_id`. Everything is DSN-gated: no `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` means inert

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
- A real Prisma `Category` model now exists, plus requirement tables `CategoryRequiredCertification`, `CategoryRequiredEquipment` and `CategoryRequiredVehicleType`
- String slugs still ride along on domain models (`JobRequest.category: String`, `Provider.skills: String[]`)

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
  - Prisma model exists (see `prisma/schema.prisma`), with requirement tables `CategoryRequiredCertification`, `CategoryRequiredEquipment`, `CategoryRequiredVehicleType`
  - String-based category fields still exist alongside it
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
- Proxy resolves the admin role from the `AdminUser` DB table (`proxy.ts` admin-path block): an inactive or missing `AdminUser` row blocks access even if Supabase metadata still says admin/owner
- `crudAction()` adds a second layer (`field-service/lib/crud-action.ts`): it resolves `AdminUser.role` from the DB and requires an active row — there is NO fallback to Supabase `user_metadata.role`
- Admin provisioning is DB-backed via `AdminUser`; backfill script: `field-service/scripts/backfill-admin-users.ts`

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

## Since-resolved items (previously listed as missing — do NOT re-introduce)
- Prisma `Category` model + `CategoryRequiredCertification` / `CategoryRequiredEquipment` / `CategoryRequiredVehicleType` requirement tables exist
- `/admin/team/permissions` page exists
- OWNER safety invariants exist in `field-service/app/(admin)/admin/team/actions.ts`: last-OWNER guard and self-role-change / self-deactivate guards
- Sentry observability is wired (see “Error boundaries already present” above); cron heartbeats live in `field-service/lib/cron-heartbeat.ts` + `/api/cron/heartbeat-watchdog`

## What’s missing that we’ll introduce
- A repo-wide understanding that this is not a blank slate; later prompts must adapt to the current implementation instead of blindly copying the scaffold
- `reference/plugapro-admin-scaffold/` path in-repo, if you want prompts to work unmodified
- Multi-role admin users; current schema supports one `role`, not `roles[]`
- Consistent server-action convention across admin routes; legacy pages still use inline `'use server'`
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
