# Admin CRUD Rollout

This document captures the rollout order, verification steps, and rollback procedure for the admin flags currently implemented in `field-service/`.

## Current implemented flags

- `admin.crud.locations`
- `admin.users.v2`
- `admin.crud.customers`
- `admin.crud.providers`
- `admin.crud.bookings`
- `admin.crud.payments`
- `admin.crud.disputes`
- `admin.crud.applications`
- `admin.crud.quotes`
- `admin.crud.dispatch`
- `admin.crud.validation`
- `admin.crud.field_exceptions`
- `admin.crud.categories`
- `admin.categories.risk_tier`
- `admin.crud.messages`
- `admin.crud.verifications`
- `admin.quotes.send`
- `admin.invoices.actions`
- `admin.messages.outbound`
- `admin.customers.whatsapp_pref_toggle`
- `admin.vouchers`
- `ops.v2.cases`
- `ops.v2.closeOut`

These flags are seeded by [seed-flags.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle%20Holdings/Solutions/Projects/Plug A Pro/field-service/scripts/seed-flags.ts).

Use the grouped rollout command for the supported ops/admin CRUD surface:

```bash
pnpm ops:crud:enable
```

The group intentionally excludes reserved or non-CRUD flags such as `admin.payments.retry`, identity-verification vendor adapters, OTP delivery, customer/provider product pilots, matching engine pilots, and qualified-shortlist rollout flags.

## Rollout order

1. `admin.crud.locations`
2. `admin.users.v2`
3. `admin.crud.customers`
4. `admin.crud.providers`
5. `admin.crud.bookings`
6. `admin.crud.payments`
7. `admin.crud.disputes`
8. `admin.crud.applications`
9. `admin.crud.quotes`
10. `admin.crud.dispatch`
11. `admin.crud.validation`
12. `admin.crud.field_exceptions`
13. `admin.crud.categories`
14. `admin.categories.risk_tier`
15. `admin.crud.messages`
16. `admin.crud.verifications`
17. `admin.quotes.send`
18. `admin.invoices.actions`
19. `admin.messages.outbound`
20. `admin.customers.whatsapp_pref_toggle`
21. `admin.vouchers`
22. `ops.v2.cases`
23. `ops.v2.closeOut`

This order keeps governance and core entity editing ahead of the queue-oriented operational pages, then enables the follow-on finance, messaging, trust, voucher, and case-management actions.

## Shared pre-flight checks

- Confirm the `FeatureFlag` rows exist in the target environment.
- Confirm the intended operator is present in `AdminUser`.
- Confirm `FEATURE_FLAGS` environment overrides are not masking DB state.
- Confirm preview or staging smoke coverage is green before production flips.
- Run `scripts/audit-admin-cutover.ts` after the `AdminUser` cutover migration is present in the target environment.

## Per-flag rollout

### `admin.crud.locations`

Internal checks:

- Open `/admin/locations`.
- Create a node.
- Inline-edit a label.
- Deactivate and delete a non-critical node.
- Confirm an `AdminAuditEvent` row exists for each mutation.

Soak:

- Staging: 24-48 hours
- Production: 24 hours

Rollback:

- Disable the flag.
- The page drops back to read-only mode.

### `admin.users.v2`

Internal checks:

- As an `OWNER`, open `/admin/team`.
- Invite a throwaway admin.
- Change their role.
- Deactivate, reactivate, and revoke as applicable.
- Confirm self-target and last-owner guards still hold.

Soak:

- Owner-only rollout for 24 hours
- Then global owner access for 24 hours

Rollback:

- Disable the flag.
- The team page drops back to read-only mode.

### `admin.crud.customers`

Internal checks:

- Open `/admin/customers`.
- Create a customer.
- Filter, export, block, suspend, archive, add notes.
- Test merge and archive scheduling paths on safe staging data.

Soak:

- Staging: 48 hours
- Production: 48 hours

Rollback:

- Disable the flag.
- Customer mutation controls hide or downgrade to read-only messaging.

### `admin.crud.providers`

Internal checks:

- Open `/admin/providers`.
- Create a provider.
- Edit profile, status, and KYC.
- Add and verify certifications.
- Add and remove equipment.
- Add strike notes and verify the strike count changes.

Soak:

- Staging: 48 hours
- Production: 48 hours

Rollback:

- Disable the flag.
- Provider mutation controls hide or downgrade to read-only messaging.

### `admin.crud.bookings`

Internal checks:

- Open `/admin/bookings/[id]`.
- Mark a safe scheduled booking as paid.
- Cancel a safe non-completed booking.
- Confirm the mutation writes land in both `AuditLog` and `AdminAuditEvent`.

Soak:

- Staging: 24-48 hours
- Production: 24 hours

Rollback:

- Disable the flag.
- The detail page remains readable and mutation controls disable.

### `admin.crud.payments`

Internal checks:

- Open `/admin/payments`.
- Claim and release a follow-up item.
- Issue a refund on a safe paid record in staging.
- Confirm queue ownership and audit writes are atomic.

Soak:

- Staging: 24-48 hours
- Production: 24 hours

Rollback:

- Disable the flag.
- Queue controls disable and refunds stop.

### `admin.crud.disputes`

Internal checks:

- Open `/admin/disputes`.
- Claim and release a dispute.
- Change status and add resolution text.
- Confirm audit rows and resolved metadata are correct.

Soak:

- Staging: 24-48 hours
- Production: 24 hours

Rollback:

- Disable the flag.
- Disputes remain visible but read-only.

### `admin.crud.applications`

Internal checks:

- Open `/admin/applications`.
- Claim and release an application.
- Approve a throwaway onboarding record.
- Reject a throwaway onboarding record.
- Confirm queue release, provider sync, and invite side effects all land correctly.

Soak:

- Staging: 48 hours
- Production: 24-48 hours

Rollback:

- Disable the flag.
- Queue controls and approve/reject controls disable.

### `admin.crud.quotes`

Internal checks:

- Open `/admin/quotes`.
- Claim and release quote-approval work.
- Confirm audit and queue ownership writes are atomic.

Soak:

- Staging: 24 hours
- Production: 24 hours

Rollback:

- Disable the flag.
- The page remains visible and queue controls disable.

### `admin.crud.dispatch`

Internal checks:

- Open `/admin/dispatch`.
- Claim and release a request.
- Refresh shortlist.
- Run auto-assign on a safe staging request.
- Override to a selected provider on staging.

Soak:

- Staging: 48 hours
- Production: 24-48 hours

Rollback:

- Disable the flag.
- Dispatch remains inspectable but the control surface disables.

### `admin.crud.validation`

Internal checks:

- Open `/admin/validation`.
- Claim and release an item.
- Mark one request ready for matching.
- Cancel one safe validation request.
- Confirm queue release and audit writes occur together.

Soak:

- Staging: 24-48 hours
- Production: 24 hours

Rollback:

- Disable the flag.
- Validation remains visible but read-only.

### `admin.crud.field_exceptions`

Internal checks:

- Open `/admin/field-exceptions`.
- Claim and release a field exception.
- Confirm queue ownership and audit writes remain atomic.

Soak:

- Staging: 24 hours
- Production: 24 hours

Rollback:

- Disable the flag.
- The page remains visible and queue controls disable.

### `admin.crud.categories`

Internal checks:

- Open `/admin/categories`.
- Create a non-production test category.
- Edit its slug, booking mode, and requirements.
- Delete it as an `OWNER`.
- Confirm matcher and job-request reads reflect DB-backed config.

Soak:

- Staging: 48 hours
- Production: 48 hours

Rollback:

- Disable the flag.
- Categories remain readable, and legacy policy fallback remains available for reads.

## Verification baseline

Before each production flip:

- `pnpm test`
- `pnpm build`
- `pnpm lint`
- Playwright smoke against preview or staging with valid `E2E_*` credentials

## Explicitly deferred

This rollout document only covers the flags that exist in the current repo state. It does not claim completion for later prompt-pack workstreams such as a platform-config editor, an audit-log viewer with search/export, or the remaining full entity CRUD migrations that still sit outside the current scope.
