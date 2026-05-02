# Execution Output — 01-ops-as-is-assessment.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_ops_dashboard_blueprint/01-ops-as-is-assessment.md`

## Objective

Assess the existing internal Admin/Ops web app, scheduler/cron jobs, matching automation, provider approval automation, credit tooling, notification monitoring, job support, and audit coverage before implementing Ops Dashboard alignment.

## Existing Ops/Admin routes

Primary admin routes already exist under `field-service/app/(admin)/admin`:

- Overview: `/admin`
- Validation: `/admin/validation`
- Dispatch/matching operations: `/admin/dispatch`
- Field exceptions: `/admin/field-exceptions`
- Quotes: `/admin/quotes`
- Bookings/jobs: `/admin/bookings`, `/admin/bookings/[id]`
- Matches: `/admin/matches`
- Provider applications: `/admin/applications`
- Providers: `/admin/providers`, `/admin/providers/[id]`
- Customers: `/admin/customers`, `/admin/customers/[id]`
- Categories: `/admin/categories`
- Locations: `/admin/locations`
- Disputes and lead refunds: `/admin/disputes`, `/admin/lead-unlock-disputes`
- Payments and provider credit top-ups: `/admin/payments`, `/admin/provider-credit-payments`
- Provider wallets: `/admin/provider-wallets`, `/admin/provider-wallets/[providerId]`
- Reports: `/admin/reports`
- Messages: `/admin/messages`
- Team and permissions: `/admin/team`, `/admin/team/permissions`
- Journey flows: `/admin/flows`
- Settings: `/admin/settings`

## Existing roles and permissions

The project has DB-backed admin roles in `Role`:

- `OPS`
- `FINANCE`
- `TRUST`
- `ADMIN`
- `OWNER`

Server-side protection exists through `requireAdmin`, `requireRole`, and `crudAction`. `crudAction` performs auth, role checks, optional feature-flag checks, input validation, and atomic audit logging to `AuditLog` plus `AdminAuditEvent`.

## Provider review tools

Existing `/admin/applications` supports:

- Listing provider applications.
- Claim/release review queue items.
- Approve application.
- Reject application.
- Request more information.
- Duplicate active application checks.
- Provider record sync on approval.
- Provider category rows from application skills.
- Starter promo credits through `awardMobileVerifiedPromoCreditsInTransaction`.
- WhatsApp approval/rejection/more-info notifications.
- Audit through `crudAction`.

Gap: the 5-minute `match-leads` cron still contains a separate 30-minute auto-approval block that approves pending applications without Ops action. This is unsafe under the new provider operating model.

## Matching tools

Existing `/admin/dispatch` and `/admin/matches` provide:

- Open/matching request queue.
- Candidate ranking via `rankCandidatesForJobRequest`.
- Manual rerank and matching trigger.
- Manual override assignment.
- Dispatch history and case notes.
- Ops queue claim/release.
- Case escalation and audit events.
- Match/quote/booking/job overview.

Current matching scheduler uses `orchestrateMatch`, which scores and dispatches provider opportunities rather than directly creating a customer booking. However, naming still says `AUTO_ASSIGN`, and legacy assignment hold concepts remain. The Qualified Shortlist services (`ProviderLeadResponse`, `ProviderShortlist`, `selectShortlistedProviderForRequest`, `acceptSelectedProviderJob`) exist but Ops visibility over shortlists and provider responses is limited.

## Cron / scheduler jobs

Configured in `field-service/vercel.json`:

- `/api/cron/reminders` daily.
- `/api/cron/follow-up` daily.
- `/api/cron/slots` weekly.
- `/api/cron/match-leads` every 5 minutes during standard hours and every 30 minutes off-hours.
- `/api/internal/cron/rebuild-candidate-pool` every 5 minutes.
- `/api/cron/session-timeout` every 20 minutes.

`/api/cron/match-leads` currently performs many duties:

- Reconciles provider capacity.
- Processes pending assignment workflows.
- Expires quotes.
- Reconciles provider records from applications.
- Auto-approves provider applications older than 30 minutes with fields present.
- Retries missing approval WhatsApp notifications.
- Expires stale job requests.
- Auto-resumes providers after temporary pause.
- Dispatches matching for open requests.
- Sends lead reminders.
- Sends unmatched/queue breach Ops alerts.

Critical gap: provider auto-approval is embedded in this cron and must be removed or converted to safe review support.

## Credit tools

Existing wallet/admin credit tools support:

- Provider wallet listing and detail pages.
- Purchased and promo balances.
- Ledger-backed admin adjustments through `adjustProviderCreditsInTransaction`.
- Wallet suspend/reactivate.
- Provider credit top-up reconciliation and crediting.
- Lead unlock disputes and refunds.
- Role protection in actions.

Potential issue to review later: wallet adjustment action currently uses an unusual role configuration (`requiredRole: OPS` with exclusions for `FINANCE`, `TRUST`, `ADMIN`, `OWNER`). This may intentionally restrict adjustments to OPS only, but it conflicts with the blueprint's finance/admin examples and needs alignment.

## Notification monitoring

Existing `/admin/messages` shows recent outbound `MessageEvent` rows:

- Recipient phone.
- Template/channel.
- Body preview.
- Booking reference.
- Status and failure reason.
- Timestamp.

Gaps:

- No retry action found on the messages page.
- No inbound WhatsApp history page found.
- Phone numbers are shown unmasked.
- Notification events are not grouped by request/job/provider journey.

## Job support tools

Existing pages cover bookings, booking detail actions, field exceptions, cases, disputes, lead unlock refunds, and dispatch cases. Ops can monitor job states and use case notes/events. More explicit stuck-job queues and scheduler-health views are still missing.

## Audit logs

Existing audit infrastructure:

- `AuditLog`
- `AdminAuditEvent`
- `crudAction`
- Case events/notes.
- Some system audit logs for matching/alerts.

Gap: sensitive view access, such as full customer phone/address in admin pages, is not consistently audited.

## Existing gaps against the redesigned journeys

| Area | Gap | Risk |
|---|---|---|
| Provider review scheduler | Cron auto-approves unvetted providers | Providers become eligible without Ops review |
| Matching/shortlist oversight | Ops has dispatch and match views but limited shortlist/provider-response visibility | Ops cannot fully explain shortlist creation and customer selection |
| Scheduler health | No dedicated scheduler status dashboard | Failures are visible only in logs/results |
| Notifications | Outbound page lacks retry/inbound monitoring and masking | Support cannot safely recover failed messages |
| Sensitive data | Full phones/addresses appear in several admin views without explicit access audit | Privacy/audit gap |
| Credit role model | Wallet actions are ledger-backed but role mapping needs review | Finance/admin workflow mismatch |
| Provider category approval | Approval creates provider category rows from skills, but category-specific review UI is limited | Category trust model not fully operationalized |

## Reuse recommendations

- Reuse `requireAdmin`, `requireRole`, and `crudAction` for server-side authorization and audit.
- Reuse existing `/admin` route tree; do not create a duplicate Ops dashboard.
- Reuse existing matching orchestrator, dispatch decisions, lead invites, provider responses, shortlists, and selected-provider acceptance services.
- Reuse wallet services for all credit adjustments; do not mutate balances directly.
- Reuse message logs and inbound WhatsApp message model for notification monitoring.
- Reuse cases and Ops queue assignments for escalation and ownership.

## Implementation risks

- Removing auto-approval must not break provider row reconciliation needed for pending applications and provider login checks.
- Matching cron changes must not accidentally regress into direct assignment or credit deduction.
- Sensitive admin pages need role/audit hardening without blocking normal Ops support.
- Scheduler health may require new persistence if existing logs are insufficient.

## Commands run

```bash
find . -path '*plugapro_ops_dashboard_blueprint*' -maxdepth 4 -type f | sort
git status --short
sed -n '1,260p' 'Plug A Pro/plugapro_ops_dashboard_blueprint/00-OPS-DASHBOARD-MASTER-RUNNER.md'
sed -n '1,260p' 'Plug A Pro/plugapro_ops_dashboard_blueprint/01-ops-as-is-assessment.md'
find field-service/app -maxdepth 5 ...
rg -n 'auto.?approve|auto.?match|cron|scheduler|...'
sed -n '1,460p' field-service/app/api/cron/match-leads/route.ts
sed -n '1,260p' field-service/app/(admin)/layout.tsx
sed -n '1,260p' field-service/lib/auth.ts
sed -n '1,260p' field-service/lib/crud-action.ts
```

## Schema / migration changes

None.

## Tests added or updated

None. This was an assessment-only step.

## OpenBrain note

Ops as-is assessment confirms the existing Admin app has strong reusable foundations: DB-backed admin roles, audited `crudAction`, provider application review, dispatch/matching pages, wallet ledger tooling, messages, cases, and cron routes. The largest immediate conflict with the redesigned operating model is cron-based provider auto-approval inside `/api/cron/match-leads`; this must be converted to safe review support so final approval remains an Ops action.
