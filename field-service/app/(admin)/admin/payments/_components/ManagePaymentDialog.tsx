'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ActionForm, SubmitButton } from '@/components/admin/ui'
// Spec (CHANGES.md C-05) calls for a <Sheet> (slide-in panel). Sheet is not yet
// installed in components/ui/. Using Dialog instead — install shadcn Sheet and
// rename this component in a follow-up before Phase 2 ships.
import {
  cancelPayAtGoPaymentFromFormAction,
  refreshPayAtGoPaymentFromFormAction,
  issueRefundFromFormAction,
  reconcilePaymentFromFormAction,
  writeOffPaymentFromFormAction,
} from '../actions'

type ManagePaymentDialogProps = {
  paymentId: string
  amount: number
  status: string
  pspProvider?: string | null
  adminRole: string
  disabled?: boolean
}

export function ManagePaymentDialog({
  paymentId,
  amount,
  status,
  pspProvider,
  adminRole,
  disabled = false,
}: ManagePaymentDialogProps) {
  const amountLabel = `R ${amount.toFixed(2)}`
  const canRefund = status === 'PAID' || status === 'PARTIALLY_REFUNDED'
  const canReconcile = status === 'PENDING' || status === 'AUTHORISED'
  const canWriteOff = status === 'PENDING' || status === 'FAILED'
  const isPayAtGo = pspProvider === 'payat_go'
  const canCancelPayAtGo = isPayAtGo && (status === 'PENDING' || status === 'AUTHORISED')

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          Manage…
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage payment</DialogTitle>
          <DialogDescription>
            Choose one finance action for payment {paymentId.slice(-8).toUpperCase()}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--tone-success-border)] bg-[var(--tone-success-bg)] px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Reconcile · mark paid</p>
                <p className="text-xs text-muted-foreground">Use only after offline collection is confirmed.</p>
              </div>
              <ActionForm
                action={reconcilePaymentFromFormAction}
                successMessage="Payment reconciled as paid"
                refreshOnSuccess
              >
                <input type="hidden" name="paymentId" value={paymentId} />
                <input type="hidden" name="reason" value="Reconciled offline by admin" />
                <SubmitButton size="sm" disabled={disabled || !canReconcile}>
                  Reconcile
                </SubmitButton>
              </ActionForm>
            </div>
          </div>

          <div className="rounded-xl border bg-card px-3 py-3">
            {isPayAtGo ? (
              <div className="mb-3 rounded-lg border bg-muted/40 px-3 py-3">
                <p className="text-sm font-medium">Pay@Go controls</p>
                <p className="text-xs text-muted-foreground">
                  Refresh provider status or cancel an unpaid Pay@Go RTP request.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionForm
                    action={refreshPayAtGoPaymentFromFormAction}
                    successMessage="Pay@Go status refreshed"
                    refreshOnSuccess
                  >
                    <input type="hidden" name="paymentId" value={paymentId} />
                    <SubmitButton size="sm" variant="outline" disabled={disabled}>
                      Refresh status
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm
                    action={cancelPayAtGoPaymentFromFormAction}
                    successMessage="Pay@Go request cancelled"
                    refreshOnSuccess
                  >
                    <input type="hidden" name="paymentId" value={paymentId} />
                    <SubmitButton size="sm" variant="outline" disabled={disabled || !canCancelPayAtGo}>
                      Cancel request
                    </SubmitButton>
                  </ActionForm>
                </div>
              </div>
            ) : null}

            <ActionForm
              action={issueRefundFromFormAction}
              successMessage="Refund processed"
              refreshOnSuccess
              className="grid gap-3 md:grid-cols-[1fr_auto]"
            >
              <div>
                <p className="text-sm font-medium">Refund</p>
                <p className="text-xs text-muted-foreground">Enter a full or partial refund amount.</p>
                <Input
                  name="amount"
                  type="number"
                  min={0.01}
                  max={amount}
                  step={0.01}
                  defaultValue={amount}
                  className="mt-2 h-8 max-w-36 text-xs"
                  disabled={disabled || !canRefund}
                />
              </div>
              <div className="self-end">
                <input type="hidden" name="paymentId" value={paymentId} />
                <SubmitButton variant="outline" size="sm" disabled={disabled || !canRefund}>
                  Open refund
                </SubmitButton>
              </div>
            </ActionForm>
          </div>

          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3">
            <ActionForm
              action={writeOffPaymentFromFormAction}
              successMessage="Payment written off"
              refreshOnSuccess
              className="grid gap-3 md:grid-cols-[1fr_auto]"
            >
              <div>
                <p className="text-sm font-medium">Write-off</p>
                <p className="text-xs text-muted-foreground">
                  Type a reason before marking {amountLabel} as a finance loss.
                </p>
                {adminRole !== 'OWNER' && (
                  <p className="mt-1 text-xs text-muted-foreground">OWNER role recommended for write-offs.</p>
                )}
                <Textarea
                  name="reason"
                  placeholder="Write-off reason…"
                  className="mt-2 min-h-20"
                  disabled={disabled || !canWriteOff}
                  required
                />
              </div>
              <div className="self-end">
                <input type="hidden" name="paymentId" value={paymentId} />
                <SubmitButton variant="destructive" size="sm" disabled={disabled || !canWriteOff}>
                  Write off
                </SubmitButton>
              </div>
            </ActionForm>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
