// Provider: Lead detail — view job info + accept/decline
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { ActionBar } from '@/components/shared/ActionBar'
import { LeadActionSubmitButton } from '@/components/provider/LeadActionSubmitButton'
import { formatDistanceToNow, format } from 'date-fns'
import { createTraceId, safeErrorMessage } from '@/lib/support-diagnostics'
import {
  ProviderLeadDetailError,
  getProviderLeadDetailForProvider,
} from '@/lib/provider-lead-detail'
import {
  LEAD_UNLOCK_DISPUTE_REASON_LABELS,
  LeadUnlockDisputeError,
  REFUNDABLE_LEAD_UNLOCK_DISPUTE_REASONS,
  disputeLeadUnlockForProvider,
} from '@/lib/lead-unlock-disputes'
import type { LeadUnlockDisputeReason } from '@prisma/client'
import { getProviderTermsUrl } from '@/lib/provider-credit-copy'

export const metadata = buildMetadata({ title: 'Lead Details', noIndex: true })

async function acceptLead(formData: FormData) {
  'use server'
  const session = await requireProvider()
  const leadId = String(formData.get('leadId') ?? '')
  const inspectionNeeded = false

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const { acceptLead: accept } = await import('@/lib/matching-engine')
  const result = await accept({ leadId, providerId: provider.id, inspectionNeeded, source: 'pwa' })

  if (!result.ok) {
    if (result.reason === 'INSUFFICIENT_CREDITS') {
      redirect(`/provider/leads/${leadId}?acceptError=credits`)
    }
    if (result.reason === 'PROVIDER_NOT_APPROVED') {
      redirect(`/provider/leads/${leadId}?acceptError=approval`)
    }
    if (result.reason === 'EXPIRED') {
      redirect(`/provider/leads/${leadId}?acceptError=expired`)
    }
    if (result.reason === 'TAKEN') {
      redirect(`/provider/leads/${leadId}?acceptError=taken`)
    }
    redirect(`/provider/leads/${leadId}?acceptError=unavailable`)
  }

  const query = new URLSearchParams({ accepted: '1' })
  if (result.currentCreditBalance != null) {
    query.set('remainingBalance', String(result.currentCreditBalance))
  }
  redirect(`/provider/leads/${leadId}?${query.toString()}`)
}

async function disputeUnlockedLead(formData: FormData) {
  'use server'
  const session = await requireProvider()
  const leadId = String(formData.get('leadId') ?? '')
  const reason = String(formData.get('reason') ?? '') as LeadUnlockDisputeReason
  const notes = String(formData.get('notes') ?? '').trim()

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  try {
    await disputeLeadUnlockForProvider(leadId, provider.id, reason, notes)
  } catch (error) {
    if (error instanceof LeadUnlockDisputeError) {
      redirect(`/provider/leads/${leadId}?dispute=${error.code === 'ALREADY_RESOLVED' ? 'resolved' : 'failed'}`)
    }
    throw error
  }

  redirect(`/provider/leads/${leadId}?dispute=submitted`)
}

async function declineLead(formData: FormData) {
  'use server'
  const session = await requireProvider()
  const leadId = String(formData.get('leadId') ?? '')
  const traceId = createTraceId('lead_decline')

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const { declineLead: decline } = await import('@/lib/matching-engine')
  let result: Awaited<ReturnType<typeof decline>>
  try {
    result = await decline({ leadId, providerId: provider.id })
  } catch (error) {
    if (isRedirectError(error)) throw error
    console.error('[provider/leads] decline lead action failed', {
      trace_id: traceId,
      lead_id: leadId,
      provider_id: provider.id,
      source: 'pwa_authenticated',
      action: 'decline',
      error_code: 'UNKNOWN_LEAD_ACTION_ERROR',
      error: safeErrorMessage(error),
    })
    redirect(`/provider/leads/${leadId}?declineError=UNKNOWN_LEAD_ACTION_ERROR&traceId=${encodeURIComponent(traceId)}`)
  }

  if (!result.ok) {
    const code = result.reason === 'NOT_FOUND' ? 'LEAD_NOT_FOUND' : 'PROVIDER_LEAD_ACCESS_DENIED'
    console.error('[provider/leads] decline lead action blocked', {
      trace_id: traceId,
      lead_id: leadId,
      provider_id: provider.id,
      source: 'pwa_authenticated',
      action: 'decline',
      result: 'blocked',
      error_code: code,
    })
    redirect(`/provider/leads/${leadId}?declineError=${code}&traceId=${encodeURIComponent(traceId)}`)
  }

  redirect(`/provider/leads/${leadId}?declined=1&traceId=${encodeURIComponent(traceId)}`)
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ leadId: string }>
  searchParams?: Promise<{ acceptError?: string; accepted?: string; remainingBalance?: string; confirmAccept?: string; dispute?: string; declined?: string; declineError?: string; traceId?: string }>
}) {
  const session = await requireProvider()
  const { leadId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })
  if (!provider) redirect('/provider')

  let lead
  try {
    lead = await getProviderLeadDetailForProvider(leadId, provider.id)
  } catch (error) {
    if (error instanceof ProviderLeadDetailError && error.code === 'FORBIDDEN') {
      redirect('/provider/leads')
    }
    throw error
  }

  if (!lead) notFound()

  // Mark as viewed if still SENT
  if (lead.status === 'SENT') {
    await db.lead.update({ where: { id: leadId }, data: { status: 'VIEWED' } })
  }

  const preview = lead.preview
  const preferredWindow = preview.preferredWindowStart
    ? `${format(preview.preferredWindowStart, 'EEE, d MMM · HH:mm')}${preview.preferredWindowEnd ? `-${format(preview.preferredWindowEnd, 'HH:mm')}` : ''}`
    : preview.requestedArrivalLatest
      ? `Before ${format(preview.requestedArrivalLatest, 'EEE, d MMM · HH:mm')}`
      : 'Flexible'
  const estimatedValue = preview.estimatedValue != null
    ? new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(preview.estimatedValue)
    : null
  const isUnlocked = lead.isUnlocked
  const unlockDispute = lead.unlock?.dispute ?? null
  const termsUrl = getProviderTermsUrl()
  const isAcceptedLead = lead.status === 'ACCEPTED'
  const canDisputeUnlock = Boolean(
    lead.unlock &&
    lead.unlock.status === 'UNLOCKED' &&
    !unlockDispute,
  )
  const totalCreditBalance = lead.wallet.totalCredits
  const hasEnoughCredits = totalCreditBalance >= lead.unlockCostCredits
  const remainingCreditBalanceAfterAccept = totalCreditBalance - lead.unlockCostCredits
  const acceptedRemainingBalance =
    resolvedSearchParams.remainingBalance != null && Number.isFinite(Number(resolvedSearchParams.remainingBalance))
      ? Number(resolvedSearchParams.remainingBalance)
      : totalCreditBalance

  const isExpired = lead.expiresAt ? lead.expiresAt < new Date() : false
  const isResponded = lead.status === 'ACCEPTED' || lead.status === 'DECLINED'
  const canAct = !isExpired && !isResponded
  const confirmingAccept = resolvedSearchParams.confirmAccept === '1' && canAct
  const unlockedDetails = lead.unlockedDetails
  const visiblePhotos = isUnlocked && unlockedDetails ? unlockedDetails.attachments : preview.attachments

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-28">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          New Lead · {lead.id.slice(-8).toUpperCase()}
        </p>
        <h1 className="text-xl font-semibold">{preview.jobType}</h1>
      </div>

      {/* Expiry banner */}
      {lead.expiresAt && !isAcceptedLead && (
        <AlertCallout tone={isExpired ? 'danger' : 'warning'}>
          {isExpired
            ? 'This lead has expired and can no longer be accepted.'
            : `Expires ${formatDistanceToNow(lead.expiresAt, { addSuffix: true })} · ${format(lead.expiresAt, 'HH:mm, d MMM')}`}
        </AlertCallout>
      )}

      {isResponded && (
        <AlertCallout tone="neutral">
          You have already {lead.status === 'ACCEPTED' ? 'accepted' : 'declined'} this lead.
        </AlertCallout>
      )}

      {resolvedSearchParams.declined && (
        <AlertCallout tone="success" title="Lead declined">
          <p>We&apos;ll offer this lead to another provider.</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide opacity-80">
            Ref: {lead.id.slice(-8).toUpperCase()}
          </p>
          {resolvedSearchParams.traceId ? (
            <p className="mt-1 text-xs opacity-80">Trace ID: {resolvedSearchParams.traceId}</p>
          ) : null}
          <div className="mt-3 grid gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/provider/leads">Available jobs</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/provider">Main menu</Link>
            </Button>
          </div>
        </AlertCallout>
      )}

      {resolvedSearchParams.declineError && (
        <AlertCallout tone="danger" title="We couldn&apos;t decline this lead">
          <p>
            {resolvedSearchParams.declineError === 'PROVIDER_LEAD_ACCESS_DENIED'
              ? 'You do not have access to decline this lead.'
              : resolvedSearchParams.declineError === 'LEAD_NOT_FOUND'
                ? 'This lead could not be found.'
                : 'The decline action could not be completed.'}
          </p>
          <p className="mt-1 text-xs opacity-80">
            Error code: {resolvedSearchParams.declineError}
            {resolvedSearchParams.traceId ? ` · Trace ID: ${resolvedSearchParams.traceId}` : ''}
          </p>
        </AlertCallout>
      )}

      {resolvedSearchParams.accepted && (
        <AlertCallout tone="success" title="Lead accepted">
          {lead.unlockCostCredits} credit{lead.unlockCostCredits === 1 ? '' : 's'} used. Balance remaining: {acceptedRemainingBalance}.
          Full customer and job details are now available below.
        </AlertCallout>
      )}

      {resolvedSearchParams.acceptError === 'credits' && (
        <AlertCallout
          tone="warning"
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/provider/credits">Top up</Link>
            </Button>
          }
        >
          You need {lead.unlockCostCredits} Plug A Pro provider credit{lead.unlockCostCredits === 1 ? '' : 's'} to accept this customer-selected job.
          Your current credits balance is {totalCreditBalance} credit{totalCreditBalance === 1 ? '' : 's'}.
        </AlertCallout>
      )}

      {resolvedSearchParams.acceptError === 'inactive' && (
        <AlertCallout tone="warning">
          Your provider profile is not active, so you cannot accept leads right now.
        </AlertCallout>
      )}

      {resolvedSearchParams.acceptError === 'approval' && (
        <AlertCallout tone="warning">
          Your provider application is still under review. You can accept leads once your profile is approved.
        </AlertCallout>
      )}

      {resolvedSearchParams.acceptError === 'expired' && (
        <AlertCallout tone="warning">
          This lead has expired and can no longer be accepted. No credits were used.
        </AlertCallout>
      )}

      {resolvedSearchParams.acceptError === 'taken' && (
        <AlertCallout tone="warning">
          This lead has already been accepted by another provider. No credits were used.
        </AlertCallout>
      )}

      {resolvedSearchParams.acceptError && !['credits', 'inactive', 'approval', 'expired', 'taken'].includes(resolvedSearchParams.acceptError) && (
        <AlertCallout tone="danger">
          This lead could not be accepted. It may no longer be available.
        </AlertCallout>
      )}

      {!isResponded && (
        <div className="app-shell-panel space-y-2 px-4 py-3 text-sm">
          <p className="font-semibold">Lead preview</p>
          <p className="text-muted-foreground">
            Customer contact, exact street address, unit, complex and access details are hidden until you accept this customer-selected job.
          </p>
          <p>
            Accepting this lead uses {lead.unlockCostCredits} credit{lead.unlockCostCredits === 1 ? '' : 's'}.
            Your current balance is {totalCreditBalance} credit{totalCreditBalance === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {confirmingAccept && (
        <AlertCallout tone="info" title="Confirm lead acceptance">
          {hasEnoughCredits ? (
            <>
              <p>
                Accepting this lead uses {lead.unlockCostCredits} credit{lead.unlockCostCredits === 1 ? '' : 's'}.
                Your current credits balance is {totalCreditBalance}. After accepting, your balance will be {remainingCreditBalanceAfterAccept}.
              </p>
              <p className="mt-1">Full customer details will be released only after acceptance succeeds.</p>
            </>
          ) : (
            <>
              <p>
                You need {lead.unlockCostCredits} credit{lead.unlockCostCredits === 1 ? '' : 's'} to accept this customer-selected job.
                Your current credits balance is {totalCreditBalance}.
              </p>
              <p className="mt-1">Top up before accepting. No customer contact or exact address details have been released.</p>
            </>
          )}
        </AlertCallout>
      )}

      {resolvedSearchParams.dispute === 'submitted' && (
        <AlertCallout tone="success">
          Refund dispute submitted. Plug-A-Pro will review it before any credits are refunded.
        </AlertCallout>
      )}

      {resolvedSearchParams.dispute && resolvedSearchParams.dispute !== 'submitted' && (
        <AlertCallout tone="danger">
          This refund dispute could not be submitted. It may already be resolved.
        </AlertCallout>
      )}

      {/* Job details */}
      <div className="rounded-xl border bg-card divide-y">
        <div className="px-4 py-3 space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Category</p>
          <p className="font-medium">{preview.category}</p>
        </div>
        <div className="px-4 py-3 space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Job type</p>
          <p className="font-medium">{preview.jobType}</p>
        </div>
        <div className="px-4 py-3 space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            {isUnlocked ? 'Full location' : 'Area preview'}
          </p>
          <p className="font-medium">
            {isUnlocked ? unlockedDetails?.fullAddress ?? 'Location on file' : preview.area}
          </p>
        </div>
        <div className="px-4 py-3 space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Preferred time</p>
          <p className="font-medium">{preferredWindow}</p>
        </div>
        {estimatedValue && (
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Estimated job value</p>
            <p className="font-medium">{estimatedValue}</p>
          </div>
        )}
        {(isUnlocked ? unlockedDetails?.fullNotes : preview.shortNotes) && (
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {isUnlocked ? 'Full job notes' : 'Short customer notes'}
            </p>
            <p className="text-sm whitespace-pre-wrap">
              {isUnlocked ? unlockedDetails?.fullNotes : preview.shortNotes}
            </p>
          </div>
        )}
        <div className="px-4 py-3 grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Balance</p>
            <p className="text-lg font-semibold">{lead.wallet.totalCredits}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className="text-lg font-semibold">{lead.wallet.paidCredits}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Starter</p>
            <p className="text-lg font-semibold">{lead.wallet.promoCredits}</p>
          </div>
        </div>
        {!isUnlocked && (
          <div className="px-4 py-3 space-y-1 text-sm">
            <p className="font-medium">Accept cost: {lead.unlockCostCredits} Plug A Pro provider credit</p>
            <p className="text-muted-foreground">
              Each customer-selected job you accept uses {lead.unlockCostCredits} credit{lead.unlockCostCredits === 1 ? '' : 's'} (1 credit = R50). Customer contact details, exact address, unit, complex, and access notes are hidden until acceptance.
              Credits use follows the <Link href={termsUrl} className="font-medium underline underline-offset-4">provider credits terms and rules</Link>.
            </p>
          </div>
        )}
        {isUnlocked && unlockedDetails && (
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Customer contact</p>
            <p className="font-medium">{unlockedDetails.customerName}</p>
            <p className="text-sm text-muted-foreground">{unlockedDetails.customerPhone}</p>
            {unlockedDetails.whatsappHref ? (
              <Button asChild size="sm" className="mt-2">
                <Link href={unlockedDetails.whatsappHref}>Contact Customer</Link>
              </Button>
            ) : null}
          </div>
        )}
        {visiblePhotos.length > 0 && (
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Customer photos</p>
            <div className="grid grid-cols-2 gap-2">
              {visiblePhotos.map((photo) => {
                const src = `/api/attachments/${photo.id}`
                return (
                  <AttachmentThumbnail
                    key={photo.id}
                    attachmentId={photo.id}
                    src={src}
                    href={src}
                    alt={photo.caption ?? 'Customer photo'}
                  />
                )
              })}
            </div>
          </div>
        )}
        <div className="px-4 py-3 space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Received</p>
          <p className="text-sm text-muted-foreground">
            {format(lead.sentAt, 'HH:mm, d MMM yyyy')}
          </p>
        </div>
      </div>

      {isUnlocked && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div>
            <h2 className="font-semibold">Refund dispute</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Refunds are reviewed for invalid leads only. Choosing another provider, quote rejection, slow response, high quote, or a customer changing their mind after a valid intro is not refundable.
            </p>
          </div>

          {unlockDispute ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-3 text-sm">
              <p className="font-medium">
                {LEAD_UNLOCK_DISPUTE_REASON_LABELS[unlockDispute.reason]}
              </p>
              <p className="mt-1 text-muted-foreground">
                Status: {unlockDispute.status.replaceAll('_', ' ').toLowerCase()}
              </p>
              {unlockDispute.notes ? (
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{unlockDispute.notes}</p>
              ) : null}
            </div>
          ) : null}

          {lead.unlock?.status === 'REFUNDED' && (
            <AlertCallout tone="success">
              This unlock was refunded. Reason: {lead.unlock.refundReason ?? 'Approved invalid lead dispute'}.
            </AlertCallout>
          )}

          {canDisputeUnlock ? (
            <form action={disputeUnlockedLead} className="space-y-3">
              <input type="hidden" name="leadId" value={leadId} />
              <select
                name="reason"
                required
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>Select refund reason</option>
                {REFUNDABLE_LEAD_UNLOCK_DISPUTE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {LEAD_UNLOCK_DISPUTE_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
              <textarea
                name="notes"
                rows={3}
                maxLength={1000}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                placeholder="Add details that help admin verify the issue."
              />
              <Button type="submit" variant="outline" className="w-full">
                Submit refund dispute
              </Button>
            </form>
          ) : null}
        </div>
      )}

      {/* Actions */}
      {canAct && (
        <div className="app-action-bar fixed bottom-0 left-0 right-0 z-40 space-y-2 px-4 py-4 safe-bottom">
          {!confirmingAccept ? (
            <>
              <Button asChild size="lg" className="w-full">
                <Link href={`/provider/leads/${leadId}?confirmAccept=1`}>
                  Accept job — uses {lead.unlockCostCredits} credit{lead.unlockCostCredits === 1 ? '' : 's'}
                </Link>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Credits balance: {totalCreditBalance} Plug A Pro provider credits · Cost: {lead.unlockCostCredits}
              </p>
            </>
          ) : hasEnoughCredits ? (
            <form action={acceptLead} className="space-y-2">
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="inspectionNeeded" value="false" />
              <LeadActionSubmitButton size="lg" className="w-full" pendingLabel="Accepting lead...">
                Confirm accept — use {lead.unlockCostCredits} credit{lead.unlockCostCredits === 1 ? '' : 's'}
              </LeadActionSubmitButton>
            </form>
          ) : (
            <>
              <Button asChild size="lg" className="w-full">
                <Link href="/provider/credits">Top up credits</Link>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                You need {lead.unlockCostCredits} credit{lead.unlockCostCredits === 1 ? '' : 's'} to accept this customer-selected job.
              </p>
            </>
          )}

          {confirmingAccept && (
            <Button asChild size="lg" variant="outline" className="w-full">
              <Link href={`/provider/leads/${leadId}`}>Back to preview</Link>
            </Button>
          )}

          <form action={declineLead}>
            <input type="hidden" name="leadId" value={leadId} />
            <LeadActionSubmitButton
              size="lg"
              variant="ghost"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
              pendingLabel="Declining..."
            >
              Decline
            </LeadActionSubmitButton>
          </form>
        </div>
      )}

      {/* Back */}
      <div className="pt-2">
        <Link href="/provider/leads" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to leads
        </Link>
      </div>
    </div>
  )
}
