'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import {
  toggleActiveFromFormAction,
  verifyProviderFromFormAction,
  reactivateProviderFromFormAction,
  setProviderStatusFromFormAction,
  setProviderKycFromFormAction,
  addProviderStrikeFromFormAction,
  deleteCertificationFromFormAction,
  deleteEquipmentFromFormAction,
} from '../actions'

// ─── helpers ──────────────────────────────────────────────────────────────────

function phoneLast4(phone: string): string {
  if (!phone || phone.length < 4) return phone || '????'
  return phone.slice(-4)
}

// ─── ProviderActionsPanel ─────────────────────────────────────────────────────

export interface ProviderActionsPanelProps {
  providerId: string
  providerName: string
  providerPhone: string
  active: boolean
  currentStatus: string
  currentKycStatus: string
  isVerified: boolean
  crudEnabled: boolean
}

export function ProviderActionsPanel({
  providerId,
  providerName,
  providerPhone,
  active,
  currentStatus,
  currentKycStatus,
  isVerified,
  crudEnabled,
}: ProviderActionsPanelProps) {
  const confirmToken = phoneLast4(providerPhone)

  // ── KYC status ───────────────────────────────────────────────────────────
  const [kycStatus, setKycStatus] = React.useState(currentKycStatus)

  // ── Status change ────────────────────────────────────────────────────────
  const [selectedStatus, setSelectedStatus] = React.useState(currentStatus)
  const [reason, setReason] = React.useState('')
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false)
  const [statusPending, startStatusTransition] = React.useTransition()

  // ── Add strike ───────────────────────────────────────────────────────────
  const [strikeBody, setStrikeBody] = React.useState('')
  const [strikeReasonCode, setStrikeReasonCode] = React.useState('PROVIDER_STRIKE_COMPLAINT')
  const [strikeDialogOpen, setStrikeDialogOpen] = React.useState(false)
  const [strikePending, startStrikeTransition] = React.useTransition()

  const isDestructiveStatus = (status: string) =>
    status === 'SUSPENDED' || status === 'BANNED' || status === 'ARCHIVED'

  function handleSetStatusClick() {
    if (!reason.trim()) return
    if (isDestructiveStatus(selectedStatus)) {
      setStatusDialogOpen(true)
    } else {
      const fd = new FormData()
      fd.set('providerId', providerId)
      fd.set('status', selectedStatus)
      fd.set('reason', reason)
      startStatusTransition(async () => {
        const result = await setProviderStatusFromFormAction(fd)
        const { notify } = await import('@/components/admin/ui/ActionToast')
        if (!result.ok) {
          notify.userError(result.error ?? 'Failed to update status')
        } else {
          setReason('')
          notify.success(`Status updated to ${selectedStatus}`)
        }
      })
    }
  }

  function runSetStatusConfirmed() {
    setStatusDialogOpen(false)
    const fd = new FormData()
    fd.set('providerId', providerId)
    fd.set('status', selectedStatus)
    fd.set('reason', reason)
    startStatusTransition(async () => {
      const result = await setProviderStatusFromFormAction(fd)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to update status')
      } else {
        setReason('')
        notify.success(`Status updated to ${selectedStatus}`)
      }
    })
  }

  function runAddStrikeConfirmed() {
    setStrikeDialogOpen(false)
    const fd = new FormData()
    fd.set('providerId', providerId)
    fd.set('body', strikeBody)
    fd.set('reasonCode', strikeReasonCode)
    startStrikeTransition(async () => {
      const result = await addProviderStrikeFromFormAction(fd)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to add strike')
      } else {
        setStrikeBody('')
        notify.success('Strike added')
      }
    })
  }

  const statusConfirmText = selectedStatus === 'ARCHIVED' ? providerName : confirmToken
  const statusConfirmTitle =
    selectedStatus === 'ARCHIVED' ? 'Archive provider' : `Set status: ${selectedStatus}`

  const inputCls =
    'h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

  if (!crudEnabled) return null

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Provider Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">

          {/* Toggle Active */}
          <ActionForm
            action={toggleActiveFromFormAction}
            successMessage={active ? 'Provider deactivated' : 'Provider activated'}
            refreshOnSuccess
          >
            <input type="hidden" name="providerId" value={providerId} />
            <SubmitButton
              type="submit"
              variant={active ? 'destructive' : 'default'}
              size="sm"
            >
              {active ? 'Deactivate' : 'Activate'}
            </SubmitButton>
          </ActionForm>

          {/* Verify provider */}
          {!isVerified && (
            <ActionForm
              action={verifyProviderFromFormAction}
              successMessage="Provider verified and set ACTIVE"
              refreshOnSuccess
            >
              <input type="hidden" name="providerId" value={providerId} />
              <SubmitButton type="submit" variant="default" size="sm">
                Verify provider &amp; set ACTIVE
              </SubmitButton>
            </ActionForm>
          )}

          {/* Reactivate */}
          {currentStatus !== 'ACTIVE' && (
            <ActionForm
              action={reactivateProviderFromFormAction}
              successMessage="Provider reactivated"
              refreshOnSuccess
            >
              <input type="hidden" name="providerId" value={providerId} />
              <SubmitButton type="submit" variant="outline" size="sm">
                Reactivate provider
              </SubmitButton>
            </ActionForm>
          )}

          {/* Status change */}
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="APPLICATION_PENDING">Application Pending</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="ARCHIVED">Archived</option>
              <option value="BANNED">Banned</option>
            </select>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason…"
              className="h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring w-52"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!reason.trim() || statusPending}
              onClick={handleSetStatusClick}
            >
              {statusPending ? 'Saving…' : 'Set status'}
            </Button>
          </div>

          {/* KYC status */}
          <ActionForm
            action={setProviderKycFromFormAction}
            successMessage="KYC status updated"
            refreshOnSuccess
            className="flex flex-wrap gap-2 items-center"
          >
            <input type="hidden" name="providerId" value={providerId} />
            <select
              name="kycStatus"
              value={kycStatus}
              onChange={(e) => setKycStatus(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="NOT_STARTED">Not started</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="VERIFIED">Verified</option>
              <option value="REJECTED">Rejected</option>
              <option value="EXPIRED">Expired</option>
            </select>
            <SubmitButton type="submit" variant="outline" size="sm">
              Set KYC
            </SubmitButton>
          </ActionForm>

          {/* Add strike */}
          <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
            <select
              value={strikeReasonCode}
              onChange={(e) => setStrikeReasonCode(e.target.value)}
              className={inputCls}
            >
              <option value="PROVIDER_STRIKE_COMPLAINT">Complaint</option>
              <option value="PROVIDER_STRIKE_LATE">Late arrival</option>
              <option value="PROVIDER_STRIKE_NO_SHOW">No show</option>
              <option value="POLICY_VIOLATION">Policy violation</option>
              <option value="ADMIN_CORRECTION">Admin correction</option>
            </select>
            <input
              value={strikeBody}
              onChange={(e) => setStrikeBody(e.target.value)}
              placeholder="Strike note…"
              className={inputCls}
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!strikeBody.trim() || strikePending}
              onClick={() => setStrikeDialogOpen(true)}
            >
              {strikePending ? 'Adding…' : 'Add strike'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Confirm dialogs ──────────────────────────────────────────────────── */}

      <DestructiveConfirmDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title={statusConfirmTitle}
        description={
          selectedStatus === 'ARCHIVED'
            ? `This provider will be archived. Reason: "${reason}". Type the provider name to confirm.`
            : `Set this provider to ${selectedStatus}. Reason: "${reason}". Type the last 4 digits of the provider's phone to confirm.`
        }
        confirmLabel={`Set ${selectedStatus}`}
        confirmText={statusConfirmText}
        onConfirm={runSetStatusConfirmed}
        loading={statusPending}
      />

      <DestructiveConfirmDialog
        open={strikeDialogOpen}
        onOpenChange={setStrikeDialogOpen}
        title="Add strike to provider"
        description={`This records a strike against the provider. Reason: "${strikeBody}". Type the last 4 digits of the provider's phone to confirm.`}
        confirmLabel="Add strike"
        confirmText={confirmToken}
        onConfirm={runAddStrikeConfirmed}
        loading={strikePending}
      />
    </>
  )
}

// ─── CertificationDeleteButton ────────────────────────────────────────────────

export interface CertificationDeleteButtonProps {
  providerId: string
  certId: string
  certName: string
}

export function CertificationDeleteButton({
  providerId,
  certId,
  certName,
}: CertificationDeleteButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function runConfirmed() {
    const fd = new FormData()
    fd.set('certId', certId)
    fd.set('providerId', providerId)
    startTransition(async () => {
      const result = await deleteCertificationFromFormAction(fd)
      setOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to delete certification')
      } else {
        notify.success('Certification deleted')
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-destructive"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        {pending ? 'Deleting…' : 'Delete'}
      </Button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete certification"
        description={`This will permanently remove the certification record. Type the certification name to confirm.`}
        confirmLabel="Delete certification"
        confirmText={certName}
        onConfirm={runConfirmed}
        loading={pending}
      />
    </>
  )
}

// ─── EquipmentDeleteButton ────────────────────────────────────────────────────

export interface EquipmentDeleteButtonProps {
  providerId: string
  equipmentId: string
  equipmentLabel: string
}

export function EquipmentDeleteButton({
  providerId,
  equipmentId,
  equipmentLabel,
}: EquipmentDeleteButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function runConfirmed() {
    const fd = new FormData()
    fd.set('equipmentId', equipmentId)
    fd.set('providerId', providerId)
    startTransition(async () => {
      const result = await deleteEquipmentFromFormAction(fd)
      setOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to delete equipment')
      } else {
        notify.success('Equipment deleted')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        className="text-destructive disabled:opacity-50"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete equipment"
        description={`This will remove the equipment record. Type the equipment label to confirm.`}
        confirmLabel="Delete equipment"
        confirmText={equipmentLabel}
        onConfirm={runConfirmed}
        loading={pending}
      />
    </>
  )
}
