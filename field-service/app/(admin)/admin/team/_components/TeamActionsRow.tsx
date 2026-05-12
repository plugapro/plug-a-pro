'use client'

import * as React from 'react'
import { notify } from '@/components/admin/ui/ActionToast'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import {
  changeRoleFromFormAction,
  deactivateAdminFromFormAction,
  reactivateAdminFromFormAction,
  revokeAdminFromFormAction,
  resendInviteFromFormAction,
} from '../actions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamActionsRowProps {
  admin: {
    id: string
    email: string
    name: string
    role: string
    active: boolean
    acceptedAt: Date | null
    userId: string
  }
  actorId: string
  actorAdminUserId: string | null
  crudEnabled: boolean
}

type DialogKind = 'deactivate' | 'revoke' | 'changeOwner' | null

// ─── Component ────────────────────────────────────────────────────────────────

export function TeamActionsRow({
  admin,
  actorId,
  actorAdminUserId,
  crudEnabled,
}: TeamActionsRowProps) {
  const [roleSelectValue, setRoleSelectValue] = React.useState(admin.role)
  const [openDialog, setOpenDialog] = React.useState<DialogKind>(null)
  const [isPending, startTransition] = React.useTransition()

  if (!crudEnabled) return null

  const isSelf =
    admin.userId === actorId || (actorAdminUserId != null && admin.id === actorAdminUserId)

  // ── Deactivate ──────────────────────────────────────────────────────────────

  const showDeactivate = admin.active && admin.acceptedAt != null && !isSelf

  const handleDeactivateConfirm = () => {
    setOpenDialog(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('adminUserId', admin.id)
      const result = await deactivateAdminFromFormAction(fd)
      if (result.ok) {
        notify.success(`${admin.name} deactivated`)
      } else {
        notify.userError(result.error ?? 'Failed to deactivate admin')
      }
    })
  }

  // ── Revoke ──────────────────────────────────────────────────────────────────

  const showRevoke = admin.active && admin.acceptedAt == null && !isSelf

  const handleRevokeConfirm = () => {
    setOpenDialog(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('adminUserId', admin.id)
      const result = await revokeAdminFromFormAction(fd)
      if (result.ok) {
        notify.success(`Invite for ${admin.email} revoked`)
      } else {
        notify.userError(result.error ?? 'Failed to revoke admin')
      }
    })
  }

  // ── Change OWNER role ───────────────────────────────────────────────────────

  const handleRoleSet = () => {
    if (roleSelectValue === 'OWNER') {
      setOpenDialog('changeOwner')
    } else {
      // Non-destructive: submit directly via hidden form ref
      const fd = new FormData()
      fd.append('adminUserId', admin.id)
      fd.append('role', roleSelectValue)
      startTransition(async () => {
        const result = await changeRoleFromFormAction(fd)
        if (result.ok) {
          notify.success(`Role updated to ${roleSelectValue}`)
        } else {
          notify.userError(result.error ?? 'Failed to change role')
        }
      })
    }
  }

  const handleChangeOwnerConfirm = () => {
    setOpenDialog(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('adminUserId', admin.id)
      fd.append('role', 'OWNER')
      const result = await changeRoleFromFormAction(fd)
      if (result.ok) {
        notify.success(`Role updated to OWNER`)
      } else {
        notify.userError(result.error ?? 'Failed to change role')
      }
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex justify-end gap-1">
        {/* Role change */}
        <div className="flex items-center gap-1">
          <select
            value={roleSelectValue}
            onChange={(e) => setRoleSelectValue(e.target.value)}
            disabled={!admin.active || isPending}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          >
            <option value="OPS">Ops</option>
            <option value="FINANCE">Finance</option>
            <option value="TRUST">Trust</option>
            <option value="ADMIN">Admin</option>
            <option value="OWNER">Owner</option>
          </select>
          <button
            type="button"
            onClick={handleRoleSet}
            disabled={!admin.active || isPending}
            className="h-7 px-2 text-xs rounded-md hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            Set
          </button>
        </div>

        {/* Resend invite — pending invite only */}
        {admin.active && admin.acceptedAt == null && (
          <ActionForm
            action={resendInviteFromFormAction}
            successMessage={`Invite re-sent to ${admin.email}`}
          >
            <input type="hidden" name="adminUserId" value={admin.id} />
            <SubmitButton
              type="submit"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              pendingLabel="Sending…"
            >
              Resend invite
            </SubmitButton>
          </ActionForm>
        )}

        {/* Reactivate — inactive admins only */}
        {!admin.active && (
          <ActionForm action={reactivateAdminFromFormAction} successMessage={`${admin.name} reactivated`}>
            <input type="hidden" name="adminUserId" value={admin.id} />
            <SubmitButton
              type="submit"
              variant="ghost"
              size="sm"
              className="h-7 text-emerald-700 hover:text-emerald-800"
              pendingLabel="Reactivating…"
            >
              Reactivate
            </SubmitButton>
          </ActionForm>
        )}

        {/* Deactivate — active + accepted + not self */}
        {showDeactivate && (
          <button
            type="button"
            onClick={() => setOpenDialog('deactivate')}
            disabled={isPending}
            className="h-7 px-2 text-xs rounded-md text-destructive hover:text-destructive/80 hover:bg-accent disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            Deactivate
          </button>
        )}

        {/* Revoke — active + pending + not self */}
        {showRevoke && (
          <button
            type="button"
            onClick={() => setOpenDialog('revoke')}
            disabled={isPending}
            className="h-7 px-2 text-xs rounded-md text-destructive hover:text-destructive/80 hover:bg-accent disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            Revoke
          </button>
        )}
      </div>

      {/* Deactivate confirm dialog */}
      <DestructiveConfirmDialog
        open={openDialog === 'deactivate'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        title={`Deactivate ${admin.name}?`}
        description="This admin will immediately lose access. They can be reactivated later."
        confirmLabel="Deactivate"
        confirmText={admin.email}
        onConfirm={handleDeactivateConfirm}
        loading={isPending}
      />

      {/* Revoke confirm dialog */}
      <DestructiveConfirmDialog
        open={openDialog === 'revoke'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        title={`Revoke invite for ${admin.name}?`}
        description="The pending invite will be cancelled and the admin row will be removed."
        confirmLabel="Revoke"
        confirmText={admin.email}
        onConfirm={handleRevokeConfirm}
        loading={isPending}
      />

      {/* Change to OWNER confirm dialog */}
      <DestructiveConfirmDialog
        open={openDialog === 'changeOwner'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        title={`Grant Owner role to ${admin.name}?`}
        description="Owners have unrestricted access to all admin actions. Only grant this to trusted team members."
        confirmLabel="Grant Owner"
        confirmText={admin.email}
        onConfirm={handleChangeOwnerConfirm}
        loading={isPending}
      />
    </>
  )
}
