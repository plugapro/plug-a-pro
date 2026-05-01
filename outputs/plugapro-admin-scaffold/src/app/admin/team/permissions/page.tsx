// /admin/team/permissions — read-only role/permission matrix.
//
// This is a static table for v1. The source of truth is the `requiredRole`
// metadata on each crudAction. A v2 could auto-generate this table by
// collecting that metadata across the codebase.

import { requireRole } from '@/lib/auth';
import { Role } from '@prisma/client';

const ROLES: Role[] = ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'];

interface PermissionRow {
  action: string;
  description: string;
  allowed: Role[];
}

const MATRIX: PermissionRow[] = [
  { action: 'customer.create', description: 'Create a customer', allowed: ['OPS', 'ADMIN', 'OWNER'] },
  { action: 'customer.update', description: 'Edit customer fields', allowed: ['OPS', 'ADMIN', 'OWNER'] },
  { action: 'customer.block', description: 'Block a customer', allowed: ['OPS', 'TRUST', 'ADMIN', 'OWNER'] },
  { action: 'customer.unblock', description: 'Unblock', allowed: ['TRUST', 'ADMIN', 'OWNER'] },
  { action: 'customer.suspend', description: 'Suspend (temporary)', allowed: ['OPS', 'TRUST', 'ADMIN', 'OWNER'] },
  { action: 'customer.archive', description: 'Soft delete', allowed: ['ADMIN', 'OWNER'] },
  { action: 'customer.delete', description: 'Hard delete', allowed: ['OWNER'] },
  { action: 'customer.merge', description: 'Merge duplicate', allowed: ['ADMIN', 'OWNER'] },
  { action: 'customer.note.add', description: 'Add internal note', allowed: ['OPS', 'TRUST', 'ADMIN', 'OWNER'] },
  { action: 'provider.create', description: 'Admin-create a provider', allowed: ['ADMIN', 'OWNER'] },
  { action: 'provider.updateProfile', description: 'Edit provider profile', allowed: ['OPS', 'ADMIN', 'OWNER'] },
  { action: 'provider.setKyc', description: 'Set KYC status', allowed: ['TRUST', 'ADMIN', 'OWNER'] },
  { action: 'provider.suspend', description: 'Suspend provider', allowed: ['TRUST', 'ADMIN', 'OWNER'] },
  { action: 'provider.reactivate', description: 'Reactivate provider', allowed: ['TRUST', 'ADMIN', 'OWNER'] },
  { action: 'provider.deactivate', description: 'Deactivate (soft delete)', allowed: ['ADMIN', 'OWNER'] },
  { action: 'provider.certification.upsert', description: 'Add / edit certification', allowed: ['TRUST', 'ADMIN', 'OWNER'] },
  { action: 'provider.equipment.upsert', description: 'Add / edit equipment', allowed: ['TRUST', 'ADMIN', 'OWNER'] },
  { action: 'adminUser.invite', description: 'Invite admin user', allowed: ['OWNER'] },
  { action: 'adminUser.updateRoles', description: 'Change an admin\'s roles', allowed: ['OWNER'] },
  { action: 'adminUser.deactivate', description: 'Deactivate admin', allowed: ['OWNER'] },
  { action: 'adminUser.revoke', description: 'Revoke admin access', allowed: ['OWNER'] },
  { action: 'location.create / update / deactivate', description: 'Manage location taxonomy', allowed: ['ADMIN', 'OWNER'] },
  { action: 'location.delete', description: 'Hard-delete location', allowed: ['OWNER'] },
];

export default async function PermissionsPage() {
  await requireRole([Role.ADMIN, Role.OWNER]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Role permission matrix</h1>
        <p className="text-sm text-muted-foreground">
          Source of truth is each action's <code>requiredRole</code>. This page is a read-only reference.
        </p>
      </header>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left font-medium">Action</th>
              <th className="p-3 text-left font-medium">Description</th>
              {ROLES.map((r) => (
                <th key={r} className="p-3 text-center font-medium">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((row) => (
              <tr key={row.action} className="border-t">
                <td className="p-3 font-mono text-xs">{row.action}</td>
                <td className="p-3 text-muted-foreground">{row.description}</td>
                {ROLES.map((r) => (
                  <td key={r} className="p-3 text-center">
                    {row.allowed.includes(r) ? '✓' : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Permissions that aren't listed default to deny. OWNER can do everything an ADMIN can; ADMIN can do
        everything an OPS / TRUST / FINANCE can that is marked accordingly.
      </p>
    </main>
  );
}
