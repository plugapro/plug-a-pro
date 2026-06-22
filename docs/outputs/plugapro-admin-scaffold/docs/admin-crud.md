# Admin CRUD — Conventions

A one-page reference for every engineer writing CRUD surfaces in the admin app.

## The four rules

1. **Every mutation goes through `crudAction()`.** No exceptions. This is how auth, roles, validation, and audit stay guaranteed by construction. If you find yourself writing a raw server action, stop.
2. **Every list query filters soft-deleted records by default.** Use `where: { archivedAt: null, ... }` unless you're explicitly rendering an archive view.
3. **Every destructive action uses `<DestructiveConfirmDialog>`.** The pattern is: the user types the entity name to confirm. This is not paranoia — it's the difference between "I accidentally nuked a provider" and "I intended to nuke this provider."
4. **Every new page and action is behind a feature flag.** Ship dark, QA internally, then flip.

## The `crudAction()` shape

```ts
export const updateCustomer = crudAction({
  name: 'customer.update',
  schema: z.object({ id: z.string(), name: z.string().min(1), ... }),
  requiredRole: [Role.OPS, Role.ADMIN, Role.OWNER],
  auditPayload: (input, out) => ({ before: out.before, after: out.after }),
  run: async (input, ctx) => {
    const before = await ctx.db.customer.findUniqueOrThrow({ where: { id: input.id } });
    const after = await ctx.db.customer.update({ where: { id: input.id }, data: input });
    return { before, after };
  },
});
```

The wrapper handles:

- Reads the session and verifies the user is authenticated.
- Confirms the user has one of the required roles.
- Validates the input against the Zod schema.
- Runs the `run()` function with a typed context containing `db` and the caller.
- Writes an `AdminAuditEvent` on success.
- Revalidates relevant admin paths.
- Returns a typed `{ ok: true, data } | { ok: false, error }`.

## Form pattern

```tsx
<CRUDForm
  schema={customerSchema}
  defaultValues={customer}
  action={updateCustomer}
  fields={[
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
    { name: 'email', label: 'Email', type: 'email' },
  ]}
  onSuccess={() => router.push(`/admin/customers/${customer.id}`)}
/>
```

Uses `react-hook-form` + `@hookform/resolvers/zod`. Submit state, inline errors, and toasts are all handled by the kit.

## Table pattern

```tsx
<CRUDTable
  columns={[
    { header: 'Name', accessor: 'name' },
    { header: 'Phone', accessor: 'phone' },
    { header: 'Bookings', accessor: 'bookingCount' },
  ]}
  rows={customers}
  rowHref={(c) => `/admin/customers/${c.id}`}
  rowActions={[
    { label: 'Edit', onSelect: (c) => openEdit(c) },
    { label: 'Block', onSelect: (c) => openBlock(c), destructive: true },
  ]}
  bulk={{
    actions: [
      { label: 'Export selected', onSelect: (rows) => exportCSV(rows) },
    ],
    maxSelect: 50,
  }}
/>
```

## Destructive action pattern

```tsx
<DestructiveConfirmDialog
  triggerLabel="Delete customer"
  title="Delete this customer?"
  description="This action is permanent. The customer will be removed from active queues."
  confirmText={customer.name}
  onConfirm={async () => { await deleteCustomer({ id: customer.id }); }}
/>
```

The user must type `customer.name` verbatim before the confirm button enables.

## Feature-flag pattern

```ts
// In the page
if (!isEnabled('admin.crud.customers', { userId })) notFound();

// In the server action (belt-and-braces)
export const createCustomer = crudAction({
  name: 'customer.create',
  requiredRole: [Role.OPS, Role.ADMIN, Role.OWNER],
  requiredFlag: 'admin.crud.customers',
  ...
});
```

## Soft-delete convention

- `archivedAt: DateTime?` on every entity that can be soft-deleted.
- Archive → `update({ data: { archivedAt: now() } })`.
- Restore → `update({ data: { archivedAt: null } })`.
- Hard delete → only allowed to `OWNER` role, and only when `archivedAt != null`.

## Audit payload convention

- `action` values: `create | update | deactivate | reactivate | delete | restore | merge | custom:<name>`.
- `payload.before` / `payload.after` — full record snapshots for creates/updates.
- `payload.reason` — required on all destructive/block actions.
- `payload.custom` — free-form object for action-specific data (e.g. `{ mergeSourceId, mergeTargetId }` for merges).

## What goes where

| Concept | Path |
|---|---|
| Core helper | `src/lib/crud-action.ts` |
| Audit helper | `src/lib/audit.ts` |
| Feature flags | `src/lib/flags.ts` |
| Auth / roles | `src/lib/auth.ts` |
| Prisma singleton | `src/lib/db.ts` |
| Kit components | `src/components/admin/crud/*` |
| Per-entity pages | `src/app/admin/<entity>/*` |
| Per-entity actions | `src/app/admin/<entity>/actions.ts` |
| Per-entity Zod schemas | `src/app/admin/<entity>/schema.ts` |
| Backfill scripts | `scripts/backfill-*.ts` |
