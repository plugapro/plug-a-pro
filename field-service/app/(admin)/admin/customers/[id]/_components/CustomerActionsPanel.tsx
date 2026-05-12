'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import {
  blockCustomerFromFormAction,
  unblockCustomerFromFormAction,
  suspendCustomerFromFormAction,
  clearCustomerSuspensionFromFormAction,
  deactivateCustomerFromFormAction,
  archiveCustomerFromFormAction,
  mergeCustomerFromFormAction,
  purgeCustomerFromFormAction,
  toggleWhatsappMarketingFromFormAction,
} from '../actions'

// ─── Shared props ─────────────────────────────────────────────────────────────

export interface CustomerActionsPanelProps {
  customerId: string
  customerPhone: string
  customerName: string
  isBlocked: boolean
  active: boolean
  isSuspended: boolean
  archivedAt: Date | null
  purgeAfter: Date | null
  mergedIntoCustomerId: string | null
  whatsappMarketingOptIn: boolean
  adminRole: string
}

// ─── WhatsAppMarketingToggle ──────────────────────────────────────────────────
// Standalone client component so it can be embedded in the WhatsApp card
// without re-mounting the full actions panel.

export function WhatsAppMarketingToggle({
  customerId,
  whatsappMarketingOptIn,
}: {
  customerId: string
  whatsappMarketingOptIn: boolean
}) {
  return (
    <ActionForm
      action={toggleWhatsappMarketingFromFormAction}
      successMessage="WhatsApp marketing preference updated"
      refreshOnSuccess
    >
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="value" value={whatsappMarketingOptIn ? 'false' : 'true'} />
      <SubmitButton
        type="submit"
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground hover:text-foreground underline h-auto p-0"
        pendingLabel="Updating…"
      >
        {whatsappMarketingOptIn ? 'Opt out (admin override)' : 'Opt in (admin override)'}
      </SubmitButton>
    </ActionForm>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function phoneLast4(phone: string): string {
  return phone.slice(-4)
}

// ─── CustomerActionsPanel ────────────────────────────────────────────────────

export function CustomerActionsPanel({
  customerId,
  customerPhone,
  customerName,
  isBlocked,
  active,
  isSuspended,
  archivedAt,
  purgeAfter,
  adminRole,
}: CustomerActionsPanelProps) {
  const confirmToken = phoneLast4(customerPhone)
  const isOwnerOrAdmin = adminRole === 'ADMIN' || adminRole === 'OWNER'
  const isOwner = adminRole === 'OWNER'
  const canPurge = isOwner && archivedAt !== null && purgeAfter !== null && purgeAfter <= new Date()

  // ── Block / Unblock ──────────────────────────────────────────────────────
  const [blockReason, setBlockReason] = React.useState('')
  const [blockDialogOpen, setBlockDialogOpen] = React.useState(false)
  const [blockPending, startBlockTransition] = React.useTransition()

  const [unblockDialogOpen, setUnblockDialogOpen] = React.useState(false)
  const [unblockPending, startUnblockTransition] = React.useTransition()

  // ── Suspend / Clear suspension ───────────────────────────────────────────
  const [suspendUntil, setSuspendUntil] = React.useState('')
  const [suspendReason, setSuspendReason] = React.useState('')
  const [suspendDialogOpen, setSuspendDialogOpen] = React.useState(false)
  const [suspendPending, startSuspendTransition] = React.useTransition()

  const [clearSuspendDialogOpen, setClearSuspendDialogOpen] = React.useState(false)
  const [clearSuspendPending, startClearSuspendTransition] = React.useTransition()

  // ── Deactivate ───────────────────────────────────────────────────────────
  const [deactivateReason, setDeactivateReason] = React.useState('')
  const [deactivateDialogOpen, setDeactivateDialogOpen] = React.useState(false)
  const [deactivatePending, startDeactivateTransition] = React.useTransition()

  // ── Archive ──────────────────────────────────────────────────────────────
  const [archiveReason, setArchiveReason] = React.useState('')
  const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false)
  const [archivePending, startArchiveTransition] = React.useTransition()

  // ── Merge ────────────────────────────────────────────────────────────────
  const [mergeTargetId, setMergeTargetId] = React.useState('')
  const [mergeReason, setMergeReason] = React.useState('')
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false)
  const [mergePending, startMergeTransition] = React.useTransition()

  // ── Purge ────────────────────────────────────────────────────────────────
  const [purgeDialogOpen, setPurgeDialogOpen] = React.useState(false)
  const [purgePending, startPurgeTransition] = React.useTransition()

  // ─── Action helpers ────────────────────────────────────────────────────────

  function runBlockConfirmed() {
    const fd = new FormData()
    fd.set('customerId', customerId)
    fd.set('reason', blockReason)
    startBlockTransition(async () => {
      const result = await blockCustomerFromFormAction(fd)
      setBlockDialogOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to block customer')
      } else {
        setBlockReason('')
        notify.success('Customer blocked')
      }
    })
  }

  function runUnblockConfirmed() {
    const fd = new FormData()
    fd.set('customerId', customerId)
    startUnblockTransition(async () => {
      const result = await unblockCustomerFromFormAction(fd)
      setUnblockDialogOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to unblock customer')
      } else {
        notify.success('Customer unblocked')
      }
    })
  }

  function runSuspendConfirmed() {
    const fd = new FormData()
    fd.set('customerId', customerId)
    fd.set('until', suspendUntil)
    fd.set('reason', suspendReason)
    startSuspendTransition(async () => {
      const result = await suspendCustomerFromFormAction(fd)
      setSuspendDialogOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to suspend customer')
      } else {
        setSuspendReason('')
        setSuspendUntil('')
        notify.success('Customer suspended')
      }
    })
  }

  function runClearSuspensionConfirmed() {
    const fd = new FormData()
    fd.set('customerId', customerId)
    startClearSuspendTransition(async () => {
      const result = await clearCustomerSuspensionFromFormAction(fd)
      setClearSuspendDialogOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to clear suspension')
      } else {
        notify.success('Suspension cleared')
      }
    })
  }

  function runDeactivateConfirmed() {
    const fd = new FormData()
    fd.set('customerId', customerId)
    fd.set('reason', deactivateReason)
    startDeactivateTransition(async () => {
      const result = await deactivateCustomerFromFormAction(fd)
      setDeactivateDialogOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to deactivate customer')
      } else {
        setDeactivateReason('')
        notify.success('Customer deactivated')
      }
    })
  }

  function runArchiveConfirmed() {
    const fd = new FormData()
    fd.set('customerId', customerId)
    fd.set('reason', archiveReason)
    startArchiveTransition(async () => {
      const result = await archiveCustomerFromFormAction(fd)
      setArchiveDialogOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to archive customer')
      } else {
        setArchiveReason('')
        notify.success('Customer archived')
      }
    })
  }

  function runMergeConfirmed() {
    const fd = new FormData()
    fd.set('sourceCustomerId', customerId)
    fd.set('targetCustomerId', mergeTargetId)
    fd.set('reason', mergeReason)
    startMergeTransition(async () => {
      const result = await mergeCustomerFromFormAction(fd)
      setMergeDialogOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to merge customer')
      } else {
        setMergeTargetId('')
        setMergeReason('')
        notify.success('Customer merged')
      }
    })
  }

  function runPurgeConfirmed() {
    const fd = new FormData()
    fd.set('customerId', customerId)
    startPurgeTransition(async () => {
      const result = await purgeCustomerFromFormAction(fd)
      setPurgeDialogOpen(false)
      const { notify } = await import('@/components/admin/ui/ActionToast')
      if (!result.ok) {
        notify.userError(result.error ?? 'Failed to purge customer')
      } else {
        notify.success('Customer purged')
      }
    })
  }

  // ─── Shared input class ────────────────────────────────────────────────────
  const inputCls = 'h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Account Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex flex-wrap items-start gap-3">

            {/* Block / Unblock */}
            {isBlocked ? (
              <button
                type="button"
                className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted transition-colors"
                onClick={() => setUnblockDialogOpen(true)}
                disabled={unblockPending}
              >
                {unblockPending ? 'Unblocking…' : 'Unblock customer'}
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  className={`${inputCls} w-60`}
                  placeholder="Reason for blocking…"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                />
                <button
                  type="button"
                  className="h-8 rounded-md bg-destructive text-destructive-foreground px-3 text-xs font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50"
                  disabled={!blockReason.trim() || blockPending}
                  onClick={() => setBlockDialogOpen(true)}
                >
                  {blockPending ? 'Blocking…' : 'Block'}
                </button>
              </div>
            )}

            {/* Suspend / Clear suspension */}
            {isSuspended ? (
              <button
                type="button"
                className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted transition-colors"
                onClick={() => setClearSuspendDialogOpen(true)}
                disabled={clearSuspendPending}
              >
                {clearSuspendPending ? 'Clearing…' : 'Clear suspension'}
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={suspendUntil}
                  onChange={(e) => setSuspendUntil(e.target.value)}
                />
                <input
                  className={`${inputCls} w-60`}
                  placeholder="Suspension reason…"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                />
                <button
                  type="button"
                  className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted transition-colors disabled:opacity-50"
                  disabled={!suspendUntil || !suspendReason.trim() || suspendPending}
                  onClick={() => setSuspendDialogOpen(true)}
                >
                  {suspendPending ? 'Suspending…' : 'Suspend'}
                </button>
              </div>
            )}

            {/* Deactivate */}
            {active && (
              <div className="flex gap-2 items-center">
                <input
                  className={`${inputCls} w-60`}
                  placeholder="Reason for deactivation…"
                  value={deactivateReason}
                  onChange={(e) => setDeactivateReason(e.target.value)}
                />
                <button
                  type="button"
                  className="h-8 rounded-md border border-destructive text-destructive px-3 text-xs font-medium hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  disabled={!deactivateReason.trim() || deactivatePending}
                  onClick={() => setDeactivateDialogOpen(true)}
                >
                  {deactivatePending ? 'Deactivating…' : 'Deactivate'}
                </button>
              </div>
            )}

            {/* Archive */}
            {isOwnerOrAdmin && (
              <div className="flex gap-2 items-center">
                <input
                  className={`${inputCls} w-60`}
                  placeholder="Archive reason…"
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                />
                <button
                  type="button"
                  className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted transition-colors disabled:opacity-50"
                  disabled={!archiveReason.trim() || archivePending}
                  onClick={() => setArchiveDialogOpen(true)}
                >
                  {archivePending ? 'Archiving…' : 'Archive'}
                </button>
              </div>
            )}

            {/* Merge */}
            {isOwner && (
              <div className="flex gap-2 items-center">
                <input
                  className={`${inputCls} w-48`}
                  placeholder="Target customer ID…"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                />
                <input
                  className={`${inputCls} w-52`}
                  placeholder="Merge reason…"
                  value={mergeReason}
                  onChange={(e) => setMergeReason(e.target.value)}
                />
                <button
                  type="button"
                  className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted transition-colors disabled:opacity-50"
                  disabled={!mergeTargetId.trim() || mergeTargetId.trim().length < 6 || !mergeReason.trim() || mergePending}
                  onClick={() => setMergeDialogOpen(true)}
                >
                  {mergePending ? 'Merging…' : 'Merge'}
                </button>
              </div>
            )}

            {/* Purge */}
            {canPurge && (
              <button
                type="button"
                className="h-8 rounded-md bg-destructive text-destructive-foreground px-3 text-xs font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50"
                disabled={purgePending}
                onClick={() => setPurgeDialogOpen(true)}
              >
                {purgePending ? 'Purging…' : 'Purge'}
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Confirm dialogs ──────────────────────────────────────────────── */}

      <DestructiveConfirmDialog
        open={blockDialogOpen}
        onOpenChange={setBlockDialogOpen}
        title="Block customer"
        description={`This will prevent the customer from booking. Reason: "${blockReason}"`}
        confirmLabel="Block customer"
        confirmText={confirmToken}
        onConfirm={runBlockConfirmed}
        loading={blockPending}
      />

      <DestructiveConfirmDialog
        open={unblockDialogOpen}
        onOpenChange={setUnblockDialogOpen}
        title="Unblock customer"
        description="This will restore the customer's ability to book."
        confirmLabel="Unblock customer"
        confirmText={confirmToken}
        onConfirm={runUnblockConfirmed}
        loading={unblockPending}
      />

      <DestructiveConfirmDialog
        open={suspendDialogOpen}
        onOpenChange={setSuspendDialogOpen}
        title="Suspend customer"
        description={`Suspend until ${suspendUntil}. Reason: "${suspendReason}"`}
        confirmLabel="Suspend"
        confirmText={confirmToken}
        onConfirm={runSuspendConfirmed}
        loading={suspendPending}
      />

      <DestructiveConfirmDialog
        open={clearSuspendDialogOpen}
        onOpenChange={setClearSuspendDialogOpen}
        title="Clear suspension"
        description="This will immediately lift the customer's suspension."
        confirmLabel="Clear suspension"
        confirmText={confirmToken}
        onConfirm={runClearSuspensionConfirmed}
        loading={clearSuspendPending}
      />

      <DestructiveConfirmDialog
        open={deactivateDialogOpen}
        onOpenChange={setDeactivateDialogOpen}
        title="Deactivate customer"
        description={`This will deactivate and block the customer. Reason: "${deactivateReason}"`}
        confirmLabel="Deactivate"
        confirmText={confirmToken}
        onConfirm={runDeactivateConfirmed}
        loading={deactivatePending}
      />

      <DestructiveConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        title="Archive customer"
        description={`The customer will be archived and set inactive. Eligible for purge after 30 days. Reason: "${archiveReason}". Type the customer name to confirm.`}
        confirmLabel="Archive"
        confirmText={customerName}
        onConfirm={runArchiveConfirmed}
        loading={archivePending}
      />

      <DestructiveConfirmDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        title="Merge customer"
        description="This merges the current customer record into the target. The source account will be deactivated. Type the customer name to confirm."
        confirmLabel="Merge"
        confirmText={customerName}
        onConfirm={runMergeConfirmed}
        loading={mergePending}
      />

      <DestructiveConfirmDialog
        open={purgeDialogOpen}
        onOpenChange={setPurgeDialogOpen}
        title="Purge customer"
        description="All personal data will be permanently deleted. This action is irreversible. Type the customer name to confirm."
        confirmLabel="Purge permanently"
        confirmText={customerName}
        onConfirm={runPurgeConfirmed}
        loading={purgePending}
      />
    </>
  )
}
