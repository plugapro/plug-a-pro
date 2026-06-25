'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CRUDTable,
  CRUDForm,
  ConfirmDialog,
  DestructiveConfirmDialog,
} from '@/components/admin/crud';
import { formatDateTime } from '@/lib/utils';
import { inviteAdminSchema } from './schema';
import {
  inviteAdmin,
  updateAdminRoles,
  deactivateAdmin,
  reactivateAdmin,
  revokeAdmin,
} from './actions';

interface AdminRow {
  id: string;
  email: string;
  name: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: Date | null;
  invitedAt: Date;
  isMe: boolean;
}

const ALL_ROLES = ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'] as const;

export function TeamClient({ admins }: { admins: AdminRow[] }) {
  const router = useRouter();
  const [inviting, setInviting] = React.useState(false);
  const [editingRoles, setEditingRoles] = React.useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={() => setInviting((v) => !v)}>
          {inviting ? 'Cancel invite' : '+ Invite admin'}
        </button>
      </div>

      {inviting && (
        <div className="rounded border bg-muted/20 p-4">
          <h2 className="mb-3 text-sm font-semibold">Invite a new admin</h2>
          <CRUDForm
            schema={inviteAdminSchema}
            defaultValues={{ email: '', name: '', roles: ['OPS'] }}
            fields={[
              { name: 'email', label: 'Email', type: 'email', required: true },
              { name: 'name', label: 'Name', type: 'text', required: true },
              {
                name: 'roles',
                label: 'Roles',
                type: 'select',
                multiple: true,
                options: ALL_ROLES.map((r) => ({ value: r, label: r })),
              },
            ]}
            action={inviteAdmin}
            onCancel={() => setInviting(false)}
            onSuccess={() => {
              setInviting(false);
              router.refresh();
            }}
            submitLabel="Send invite"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            An invite email / WhatsApp link will be sent via your configured provider.
          </p>
        </div>
      )}

      <CRUDTable<AdminRow>
        rows={admins}
        columns={[
          { header: 'Name', render: (r) => (
            <span>
              {r.name}
              {r.isMe && <span className="ml-2 rounded bg-muted px-1 text-[10px]">you</span>}
            </span>
          ) },
          { header: 'Email', accessor: 'email' },
          {
            header: 'Roles',
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                {r.roles.map((role) => (
                  <span key={role} className="rounded bg-muted px-2 py-0.5 text-xs">{role}</span>
                ))}
              </div>
            ),
          },
          {
            header: 'Status',
            render: (r) => (r.isActive ? <span className="text-green-700">Active</span> : <span className="text-muted-foreground">Inactive</span>),
          },
          { header: 'Last login', render: (r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : 'Never') },
          {
            header: 'Actions',
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                <button className="rounded border px-2 py-0.5 text-xs" onClick={() => setEditingRoles(r.id)}>
                  Edit roles
                </button>
                {r.isActive ? (
                  <ConfirmDialog
                    triggerLabel="Deactivate"
                    triggerClassName="px-2 py-0.5 text-xs"
                    title={`Deactivate ${r.name}?`}
                    description="They will be unable to sign in. Reactivate later if needed."
                    onConfirm={async () => {
                      const res = await deactivateAdmin({ id: r.id });
                      if (!res.ok) alert(res.message);
                      router.refresh();
                    }}
                  />
                ) : (
                  <ConfirmDialog
                    triggerLabel="Reactivate"
                    triggerClassName="px-2 py-0.5 text-xs"
                    title={`Reactivate ${r.name}?`}
                    description="They will be able to sign in again immediately."
                    onConfirm={async () => {
                      const res = await reactivateAdmin({ id: r.id });
                      if (!res.ok) alert(res.message);
                      router.refresh();
                    }}
                  />
                )}
                {!r.isMe && (
                  <DestructiveConfirmDialog
                    triggerLabel="Revoke"
                    triggerClassName="px-2 py-0.5 text-xs"
                    title={`Revoke ${r.name}?`}
                    description="Permanent — removes access and archives the admin record. Audit trail is preserved."
                    confirmText={r.email}
                    confirmLabel="Revoke"
                    onConfirm={async () => {
                      const res = await revokeAdmin({ id: r.id, reasonCode: 'SECURITY' });
                      if (!res.ok) alert(res.message);
                      router.refresh();
                    }}
                  />
                )}
              </div>
            ),
          },
        ]}
        emptyState={<p>No admin users. Use "Invite admin" above.</p>}
      />

      {editingRoles && (
        <EditRolesModal
          admin={admins.find((a) => a.id === editingRoles)!}
          onClose={() => setEditingRoles(null)}
          onSaved={() => {
            setEditingRoles(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EditRolesModal({ admin, onClose, onSaved }: { admin: AdminRow; onClose: () => void; onSaved: () => void }) {
  const [roles, setRoles] = React.useState<string[]>(admin.roles);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const toggle = (role: string) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Edit roles — {admin.name}</h2>
        <div className="mt-3 space-y-2">
          {ALL_ROLES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            disabled={roles.length === 0 || pending}
            onClick={async () => {
              setPending(true);
              const res = await updateAdminRoles({ id: admin.id, roles: roles as any });
              setPending(false);
              if (!res.ok) {
                setError(res.message);
                return;
              }
              onSaved();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
