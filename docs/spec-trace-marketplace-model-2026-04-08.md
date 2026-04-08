# Marketplace Model Spec Trace

Date: 2026-04-08

Source spec: [docs/architecture/marketplace-model.md](./architecture/marketplace-model.md)

Scope of this trace:
- Trace the Phase 1 / MVP checklist in the marketplace model against the current repository state.
- Keep the board limited to items that are still unimplemented or not verifiable from repository evidence.
- Treat payments as intentionally deferred for launch adoption mode unless the Phase 1 spec explicitly requires them.

## Launch-mode note

Platform-assisted payments are defined in the marketplace model as a Phase 2 item, not a Phase 1 launch requirement.

The current codebase now supports two collection modes in [field-service/lib/payments.ts](../field-service/lib/payments.ts):
- `bypass` (default for adoption phase)
- `checkout` (ready to be enabled later)

Quote approval and booking creation now initialize a payment record in launch mode without forcing real checkout first. That keeps the MVP journey moving while preserving a controlled path to later payment activation.

## Trace Summary

### Customer side

| Spec item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| WhatsApp job request intake | Implemented | [field-service/app/api/webhooks/whatsapp/route.ts](../field-service/app/api/webhooks/whatsapp/route.ts), [field-service/lib/whatsapp-bot.ts](../field-service/lib/whatsapp-bot.ts) | Customer intake flows are handled through the WhatsApp webhook and bot state machine. |
| Service category selection | Implemented | [field-service/lib/whatsapp-bot.ts](../field-service/lib/whatsapp-bot.ts) | Category selection is part of the job intake flow. |
| Address and timing capture | Implemented | [field-service/lib/whatsapp-bot.ts](../field-service/lib/whatsapp-bot.ts), [field-service/app/api/customer/bookings/route.ts](../field-service/app/api/customer/bookings/route.ts) | Intake collects address and timing / availability notes. |
| Match notification (which provider accepted) | Implemented | [field-service/lib/whatsapp-bot.ts](../field-service/lib/whatsapp-bot.ts), [field-service/lib/whatsapp-flows/status.ts](../field-service/lib/whatsapp-flows/status.ts) | Acceptance path now notifies the customer after provider acceptance. |
| Provider profile view (skills, rating, review count) | Implemented | [field-service/app/(customer)/providers/[id]/page.tsx](../field-service/app/(customer)/providers/%5Bid%5D/page.tsx), [field-service/app/(customer)/bookings/[id]/page.tsx](../field-service/app/(customer)/bookings/%5Bid%5D/page.tsx), [field-service/app/(customer)/requests/[id]/page.tsx](../field-service/app/(customer)/requests/%5Bid%5D/page.tsx) | Added authenticated customer-facing provider profile and linked it from request / booking surfaces. |
| Quote approval flow | Implemented | [field-service/app/quotes/[token]/page.tsx](../field-service/app/quotes/%5Btoken%5D/page.tsx), [field-service/app/api/quotes/[token]/route.ts](../field-service/app/api/quotes/%5Btoken%5D/route.ts), [field-service/lib/quotes.ts](../field-service/lib/quotes.ts) | Quote review and approval are live; launch-mode payment behavior is returned with the approval response. |
| Job status updates (en route, arrived, in progress, done) | Implemented | [field-service/lib/whatsapp-flows/status.ts](../field-service/lib/whatsapp-flows/status.ts), [field-service/app/(customer)/bookings/[id]/page.tsx](../field-service/app/(customer)/bookings/%5Bid%5D/page.tsx), [field-service/app/(customer)/requests/[id]/page.tsx](../field-service/app/(customer)/requests/%5Bid%5D/page.tsx) | Customer can track current request / booking state and receives WhatsApp status links. |
| Review submission | Implemented | [field-service/app/(customer)/bookings/[id]/rate/page.tsx](../field-service/app/(customer)/bookings/%5Bid%5D/rate/page.tsx) | Customer review flow exists after job completion. |

### Provider side

| Spec item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| WhatsApp + web registration | Implemented | [field-service/lib/whatsapp-bot.ts](../field-service/lib/whatsapp-bot.ts), [marketing/app/(marketing)/for-workers/page.tsx](../marketing/app/%28marketing%29/for-workers/page.tsx), [field-service/app/(admin)/admin/applications/page.tsx](../field-service/app/%28admin%29/admin/applications/page.tsx) | WhatsApp application flow exists and approved applications create verified providers. |
| Skill and area profile | Implemented | [field-service/app/(provider)/provider/profile/page.tsx](../field-service/app/%28provider%29/provider/profile/page.tsx), [field-service/app/(technician)/technician/profile/page.tsx](../field-service/app/%28technician%29/technician/profile/page.tsx) | Provider profile exposes skills, service areas, bio, and availability details. |
| Lead receive + accept/decline on WhatsApp | Implemented | [field-service/lib/whatsapp-bot.ts](../field-service/lib/whatsapp-bot.ts), [field-service/lib/matching-engine.ts](../field-service/lib/matching-engine.ts) | Matching now fans out to up to 3 providers, tracks responses, and reopens requests if needed. |
| Fixed-price confirmation or custom quote submission | Implemented | [field-service/app/api/technician/quotes/route.ts](../field-service/app/api/technician/quotes/route.ts), [field-service/app/(provider)/provider/quotes/[matchId]/page.tsx](../field-service/app/%28provider%29/provider/quotes/%5BmatchId%5D/page.tsx), [field-service/app/(technician)/technician/quotes/[matchId]/page.tsx](../field-service/app/%28technician%29/technician/quotes/%5BmatchId%5D/page.tsx) | Quote flow supports direct and inspection-based quoting. Inspection completion is now required before post-inspection quote submission. |
| Job status updates via app or WhatsApp | Implemented | [field-service/app/(provider)/provider/jobs/[id]/page.tsx](../field-service/app/%28provider%29/provider/jobs/%5Bid%5D/page.tsx), [field-service/app/(technician)/technician/jobs/[id]/page.tsx](../field-service/app/%28technician%29/technician/jobs/%5Bid%5D/page.tsx), [field-service/lib/whatsapp-flows/status.ts](../field-service/lib/whatsapp-flows/status.ts) | Provider job pages expose status controls and WhatsApp flows surface state updates. |
| Photo upload (before/after) | Implemented | [field-service/components/technician/PhotoUpload.tsx](../field-service/components/technician/PhotoUpload.tsx), [field-service/app/api/technician/jobs/[id]/photo/route.ts](../field-service/app/api/technician/jobs/%5Bid%5D/photo/route.ts) | Photo upload exists and app rendering now prefers the attachment proxy. |
| View own rating and review history | Implemented | [field-service/app/(provider)/provider/profile/page.tsx](../field-service/app/%28provider%29/provider/profile/page.tsx), [field-service/app/(technician)/technician/profile/page.tsx](../field-service/app/%28technician%29/technician/profile/page.tsx) | Review history sections were added to both provider-facing profile surfaces. |

### Platform (admin)

| Spec item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Provider application review and approval | Implemented | [field-service/app/(admin)/admin/applications/page.tsx](../field-service/app/%28admin%29/admin/applications/page.tsx) | Approved providers are now created as verified and can receive leads. |
| Job request monitoring | Implemented | [field-service/app/(admin)/admin/matches/page.tsx](../field-service/app/%28admin%29/admin/matches/page.tsx), [field-service/app/(admin)/admin/dispatch/page.tsx](../field-service/app/%28admin%29/admin/dispatch/page.tsx) | `/admin/matches` is now the moderation / monitoring surface; `/admin/dispatch` redirects there. |
| Dispute flagging (manual review for now) | Implemented | [field-service/app/(customer)/bookings/[id]/page.tsx](../field-service/app/%28customer%29/bookings/%5Bid%5D/page.tsx), [field-service/app/(provider)/provider/jobs/[id]/page.tsx](../field-service/app/%28provider%29/provider/jobs/%5Bid%5D/page.tsx), [field-service/app/(technician)/technician/jobs/[id]/page.tsx](../field-service/app/%28technician%29/technician/jobs/%5Bid%5D/page.tsx), [field-service/app/(admin)/admin/disputes/page.tsx](../field-service/app/%28admin%29/admin/disputes/page.tsx) | Customer and provider/technician can raise disputes; admin can review and resolve them manually. |
| Basic platform metrics | Implemented | [field-service/app/(admin)/admin/page.tsx](../field-service/app/%28admin%29/admin/page.tsx) | Dashboard shows bookings, jobs, quotes, revenue, applications, requests, and provider counts. |

### Technical

| Spec item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Corrected schema (remove businessId FKs, rename Technician → Provider) | Implemented | [field-service/prisma/schema.prisma](../field-service/prisma/schema.prisma), [field-service/app/api/customer/bookings/route.ts](../field-service/app/api/customer/bookings/route.ts) | Runtime code now follows the provider model and the old `businessId` assumptions have been removed from current flows. |
| Matching engine: simple rules (category match + suburb overlap + active status) | Implemented | [field-service/lib/matching-engine.ts](../field-service/lib/matching-engine.ts) | Matching uses provider skills, service areas, and active / available / verified state, with up to 3 candidates dispatched per request. |
| WhatsApp flows updated to marketplace language | Implemented | [field-service/lib/whatsapp-bot.ts](../field-service/lib/whatsapp-bot.ts), [field-service/lib/whatsapp-flows/help.ts](../field-service/lib/whatsapp-flows/help.ts), [field-service/lib/whatsapp-flows/registration.ts](../field-service/lib/whatsapp-flows/registration.ts), [field-service/lib/whatsapp-flows/status.ts](../field-service/lib/whatsapp-flows/status.ts) | Public and bot copy now matches the provider / customer marketplace model and launch-mode payment posture. |
| Mediated messaging relay | Not implemented | [docs/architecture/marketplace-model.md](./architecture/marketplace-model.md), [field-service/lib/whatsapp.ts](../field-service/lib/whatsapp.ts) | The spec still calls for platform-relayed customer↔provider messaging. Current code logs inbound messages and supports notifications, but does not provide an implemented relay workflow. |
| Notification templates approved in Meta | Missing external verification | [field-service/scripts/register-whatsapp-templates.mjs](../field-service/scripts/register-whatsapp-templates.mjs), [field-service/README.md](../field-service/README.md) | Repository evidence shows template registration scripts and comments about approved / pending templates, but actual Meta approval state cannot be proven from code alone. |

## Remaining Items Left On The Board

These are the only Phase 1 checklist items still open after the current implementation pass.

1. Mediated messaging relay
   - Status: Unimplemented
   - Why it is still open: the repository does not contain a real customer↔provider relay flow through the platform bot, only notification handling and inbound message logging.
   - Evidence: [docs/architecture/marketplace-model.md](./architecture/marketplace-model.md), [field-service/lib/whatsapp.ts](../field-service/lib/whatsapp.ts)
   - Release treatment: public claims about relay chat were removed so the product no longer over-promises this behavior.

2. Notification templates approved in Meta
   - Status: Not verifiable from repository evidence
   - Why it is still open: code can show scripts, config, and comments, but not current approval state inside Meta Business Manager.
   - Evidence: [field-service/scripts/register-whatsapp-templates.mjs](../field-service/scripts/register-whatsapp-templates.mjs), [field-service/README.md](../field-service/README.md)
   - Release treatment: operational verification still needs to be done outside the repo.

## Out Of Scope For Phase 1

These items are intentionally not left on the Phase 1 board because the source spec places them after launch:

- Platform-assisted payments
- Automated dispute flow
- Provider subscription option
- Geographic expansion
- Provider identity verification
- Customer geolocation matching improvements
- Rich analytics dashboard beyond basic platform metrics

## Verification Snapshot

Local verification completed after the implementation pass:

- `cd field-service && npm run test` ✅
- `cd field-service && npm run build` ✅
- `cd marketing && npm run build` ✅

Known non-blocking warning still present:

- `marketing` build warns that missing Supabase environment variables will break lead capture and chat routes at runtime until env vars are configured.
