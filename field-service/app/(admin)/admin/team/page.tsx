// ─── Admin: Team Management ────────────────────────────────────────────────────
// Lists AdminUser records with invite, role-change and deactivate actions.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { inviteAdminFromFormAction } from './actions'
import { TeamActionsRow } from './_components/TeamActionsRow'

export const metadata = buildMetadata({ title: 'Team', noIndex: true })

const ROLE_LABELS: Record<string, string> = {
  OPS: 'Ops',
  FINANCE: 'Finance',
  TRUST: 'Trust & Safety',
  ADMIN: 'Admin',
  OWNER: 'Owner',
}

const ROLE_BADGE: Record<string, string> = {
  OPS: 'secondary',
  FINANCE: 'secondary',
  TRUST: 'secondary',
  ADMIN: 'default',
  OWNER: 'default',
}

export default async function TeamPage() {
  const actor = await requireRole(['OWNER'])
  const crudEnabled = await isEnabled('admin.users.v2', { userId: actor.id })

  const admins = await db.adminUser.findMany({
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      userId: true,
      email: true,
      name: true,
      role: true,
      active: true,
      invitedAt: true,
      acceptedAt: true,
      invitedBy: { select: { name: true } },
    },
  })

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="text-sm text-muted-foreground">
            {admins.filter((a) => a.active).length} active admin{admins.filter((a) => a.active).length !== 1 ? 's' : ''}
            {admins.filter((a) => !a.active).length > 0 && (
              <span className="ml-1 text-muted-foreground/70">
                ({admins.filter((a) => !a.active).length} inactive)
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/team/permissions">Permission matrix</Link>
        </Button>
      </div>

      {/* ── Flag banner ──────────────────────────────────────────────────────── */}
      {!crudEnabled && (
        <div className="tone-warning mb-4 rounded-lg border px-4 py-2 text-sm">
          Team management is in read-only mode. Enable the <code>admin.users.v2</code> feature flag to invite or modify admin accounts.
        </div>
      )}

      {/* ── Invite form ──────────────────────────────────────────────────────── */}
      {crudEnabled && (
        <details className="mb-8 rounded-xl border overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium bg-muted/30 hover:bg-muted/50 select-none">
            Invite admin
          </summary>
          <ActionForm
            action={inviteAdminFromFormAction}
            resetOnSuccess={true}
            refreshOnSuccess={true}
            successMessage="Invite sent"
            className="p-4 grid gap-3 sm:grid-cols-3"
          >
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium" htmlFor="invite-name">Name</label>
              <input
                id="invite-name"
                name="name"
                required
                placeholder="Jane Smith"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium" htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                placeholder="jane@plugapro.co.za"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium" htmlFor="invite-role">Role</label>
              <select
                id="invite-role"
                name="role"
                required
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select role…</option>
                <option value="OPS">Ops</option>
                <option value="FINANCE">Finance</option>
                <option value="TRUST">Trust & Safety</option>
                <option value="ADMIN">Admin</option>
                <option value="OWNER">Owner</option>
              </select>
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <SubmitButton type="submit" size="sm" pendingLabel="Sending…">
                Send invite
              </SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}

      {/* ── Team table ───────────────────────────────────────────────────────── */}
      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="hidden md:table-cell">Invited</TableHead>
              <TableHead className="hidden md:table-cell">Invited by</TableHead>
              {crudEnabled && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.length === 0 && (
              <TableRow>
                <TableCell colSpan={crudEnabled ? 6 : 5} className="h-24 text-center text-muted-foreground">
                  No admin accounts yet.
                </TableCell>
              </TableRow>
            )}
            {admins.map((admin) => (
              <TableRow key={admin.id} className={!admin.active ? 'opacity-50' : ''}>
                <TableCell>
                  <div className="font-medium">{admin.name}</div>
                  <div className="text-xs text-muted-foreground">{admin.email}</div>
                  {!admin.acceptedAt && admin.active && (
                    <div className="text-xs text-amber-600 mt-0.5">Invite pending</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={ROLE_BADGE[admin.role] as 'default' | 'secondary'}>
                    {ROLE_LABELS[admin.role] ?? admin.role}
                  </Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {admin.active ? (
                    <Badge variant="default" className="rounded-full">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-full text-muted-foreground">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {admin.invitedAt.toLocaleDateString('en-ZA')}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {admin.invitedBy?.name ?? '-'}
                </TableCell>
                {crudEnabled && (
                  <TableCell className="text-right">
                    <TeamActionsRow
                      admin={admin}
                      actorId={actor.id}
                      actorAdminUserId={actor.adminUserId ?? null}
                      crudEnabled={crudEnabled}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
