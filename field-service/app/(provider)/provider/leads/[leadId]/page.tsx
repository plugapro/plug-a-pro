// Provider: Lead detail — view job info + accept/decline
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { formatDistanceToNow, format } from 'date-fns'
import { getCategoryPolicy } from '@/lib/service-category-policy'
import { LeadUnlockError, unlockLeadForProvider } from '@/lib/lead-unlocks'
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

export const metadata = buildMetadata({ title: 'Lead Details', noIndex: true })

async function acceptLead(formData: FormData) {
  'use server'
  const session = await requireProvider()
  const leadId = String(formData.get('leadId') ?? '')
  const inspectionNeeded = formData.get('inspectionNeeded') === 'true'

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const { acceptLead: accept } = await import('@/lib/matching-engine')
  const result = await accept({ leadId, providerId: provider.id, inspectionNeeded, source: 'pwa' })

  if (!result.ok) {
    if (result.reason === 'INSUFFICIENT_CREDITS') {
      redirect(`/provider/leads/${leadId}?unlockError=credits`)
    }
    if (result.reason === 'KYC_REQUIRED') {
      redirect(`/provider/leads/${leadId}?unlockError=kyc`)
    }
    // Lead expired or taken — go back to leads list with the status visible
    redirect('/provider/leads')
  }

  redirect(`/provider/quotes/${result.matchId}`)
}

async function unlockLead(formData: FormData) {
  'use server'
  const session = await requireProvider()
  const leadId = String(formData.get('leadId') ?? '')

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  try {
    await unlockLeadForProvider(leadId, provider.id)
  } catch (error) {
    if (error instanceof LeadUnlockError) {
      const reason = error.code === 'INSUFFICIENT_CREDITS'
        ? 'credits'
        : error.code === 'KYC_REQUIRED'
          ? 'kyc'
          : 'unavailable'
      redirect(`/provider/leads/${leadId}?unlockError=${reason}`)
    }
    throw error
  }

  redirect(`/provider/leads/${leadId}?unlocked=1`)
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

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const { declineLead: decline } = await import('@/lib/matching-engine')
  await decline({ leadId, providerId: provider.id })

  redirect('/provider/leads')
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ leadId: string }>
  searchParams?: Promise<{ unlockError?: string; unlocked?: string; dispute?: string }>
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
  const canDisputeUnlock = Boolean(
    lead.unlock &&
    lead.unlock.status === 'UNLOCKED' &&
    !unlockDispute,
  )
  const totalCreditBalance = lead.wallet.totalCredits
  const kycApproved = lead.provider.kycStatus === 'VERIFIED'
  const hasEnoughCredits = totalCreditBalance >= lead.unlockCostCredits

  const isExpired = lead.expiresAt ? lead.expiresAt < new Date() : false
  const isResponded = lead.status === 'ACCEPTED' || lead.status === 'DECLINED'
  const canAct = !isExpired && !isResponded

  // Hide "Inspection First" for simple categories where bookingOnAssignment is true
  // (e.g. garden, handyman, cleaning, diy) — these don't need a site visit before quoting.
  const categoryPolicy = getCategoryPolicy(preview.category)
  const showInspectionOption = !categoryPolicy.bookingOnAssignment
  const unlockedDetails = lead.unlockedDetails

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
      {lead.expiresAt && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          isExpired
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          {isExpired
            ? 'This lead has expired and can no longer be accepted.'
            : `Expires ${formatDistanceToNow(lead.expiresAt, { addSuffix: true })} · ${format(lead.expiresAt, 'HH:mm, d MMM')}`}
        </div>
      )}

      {isResponded && (
        <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          You have already {lead.status === 'ACCEPTED' ? 'accepted' : 'declined'} this lead.
        </div>
      )}

      {resolvedSearchParams.unlocked && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Lead unlocked. Full customer and job details are now available.
        </div>
      )}

      {resolvedSearchParams.unlockError === 'credits' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You need at least 1 Plug-A-Pro Credit to unlock this lead.
          <Link href="/provider/credits" className="ml-1 font-medium underline underline-offset-4">
            Top up credits
          </Link>
        </div>
      )}

      {resolvedSearchParams.unlockError === 'kyc' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          KYC must be approved before unlocking full customer details.
        </div>
      )}

      {resolvedSearchParams.unlockError && !['credits', 'kyc'].includes(resolvedSearchParams.unlockError) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          This lead could not be unlocked. It may no longer be available.
        </div>
      )}

      {resolvedSearchParams.dispute === 'submitted' && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Refund dispute submitted. Plug-A-Pro will review it before any credits are refunded.
        </div>
      )}

      {resolvedSearchParams.dispute && resolvedSearchParams.dispute !== 'submitted' && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          This refund dispute could not be submitted. It may already be resolved.
        </div>
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
            <p className="text-xs text-muted-foreground">Promo</p>
            <p className="text-lg font-semibold">{lead.wallet.promoCredits}</p>
          </div>
        </div>
        {!isUnlocked && (
          <div className="px-4 py-3 space-y-1 text-sm">
            <p className="font-medium">Unlock cost: {lead.unlockCostCredits} Plug-A-Pro Credit</p>
            <p className="text-muted-foreground">
              Credits are used to unlock verified matched leads. Customer contact details, exact address, and photos are hidden until unlock.
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
        {isUnlocked && unlockedDetails && unlockedDetails.attachments.length > 0 && (
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Customer photos</p>
            <div className="grid grid-cols-2 gap-2">
              {unlockedDetails.attachments.map((photo) => {
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
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
              This unlock was refunded. Reason: {lead.unlock.refundReason ?? 'Approved invalid lead dispute'}.
            </div>
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
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t px-4 py-4 space-y-2 safe-bottom">
          {!isUnlocked ? (
            <>
              {!kycApproved ? (
                <Button asChild size="lg" className="w-full">
                  <Link href="/provider/profile">Complete KYC to Unlock</Link>
                </Button>
              ) : !hasEnoughCredits ? (
                <Button asChild size="lg" className="w-full">
                  <Link href="/provider/credits">Top Up to Unlock</Link>
                </Button>
              ) : (
                <form action={unlockLead}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <Button type="submit" size="lg" className="w-full">
                    Unlock Lead
                  </Button>
                </form>
              )}
              <p className="text-center text-xs text-muted-foreground">
                Balance: {totalCreditBalance} Plug-A-Pro Credits · Cost: {lead.unlockCostCredits}
              </p>
            </>
          ) : (
            <form action={acceptLead} className="space-y-2">
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="inspectionNeeded" value="false" />
              <Button type="submit" size="lg" className="w-full">
                Accept and build quote
              </Button>
            </form>
          )}

          {isUnlocked && showInspectionOption && (
            <form action={acceptLead}>
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="inspectionNeeded" value="true" />
              <Button type="submit" size="lg" variant="outline" className="w-full">
                Inspection first
              </Button>
            </form>
          )}

          <form action={declineLead}>
            <input type="hidden" name="leadId" value={leadId} />
            <Button
              type="submit"
              size="lg"
              variant="ghost"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              Skip
            </Button>
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
