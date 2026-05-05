export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { ArrivalSubmitButton } from '@/components/provider/ArrivalSubmitButton'
import { LeadActionSubmitButton } from '@/components/provider/LeadActionSubmitButton'
import { db } from '@/lib/db'
import {
  providerLeadTokenAllowsScope,
  resolveProviderLeadAccessToken,
  verifyProviderLeadAccessToken,
} from '@/lib/provider-lead-access'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { LEAD_UNLOCK_COST_CREDITS } from '@/lib/lead-unlocks'
import {
  deriveDefaultArrivalWindow,
  getCustomerAvailabilitySummary,
} from '@/lib/arrival-availability'
import {
  markAcceptedLeadAction,
  saveAcceptedLeadArrival,
  sendFreshAcceptedJobLink,
} from '@/lib/accepted-job-actions'
import { createTraceId, maskPhone, safeErrorMessage, timestamp, type DiagnosticCode } from '@/lib/support-diagnostics'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { getProviderTermsUrl } from '@/lib/provider-credit-copy'

type LeadActionErrorParams = {
  error: string
  errorCode: string
  action: 'accept' | 'decline'
  traceId: string
  message?: string
  creditDeducted?: boolean
}

function redirectLeadActionError(token: string, params: LeadActionErrorParams): never {
  const query = new URLSearchParams({
    error: params.error,
    errorCode: params.errorCode,
    action: params.action,
    actionTraceId: params.traceId,
  })
  if (params.message) query.set('errorMessage', params.message)
  if (params.creditDeducted != null) query.set('creditDeducted', params.creditDeducted ? '1' : '0')
  redirect(`/leads/access/${encodeURIComponent(token)}?${query.toString()}`)
}

function acceptErrorCode(reason: string) {
  switch (reason) {
    case 'INSUFFICIENT_CREDITS':
      return 'INSUFFICIENT_CREDITS'
    case 'PROVIDER_NOT_APPROVED':
      return 'PROVIDER_NOT_APPROVED'
    case 'EXPIRED':
      return 'LEAD_EXPIRED'
    case 'TAKEN':
      return 'LEAD_ALREADY_ACCEPTED'
    case 'NOT_FOUND':
      return 'LEAD_NOT_FOUND'
    case 'FORBIDDEN':
      return 'PROVIDER_NOT_AUTHORIZED'
    case 'CONCURRENT_UNLOCK':
      return 'DUPLICATE_ACTION_IGNORED'
    case 'WALLET_SUSPENDED':
      return 'CREDIT_DEDUCTION_FAILED'
    default:
      return 'LEAD_ACCEPTANCE_FAILED'
  }
}

async function acceptLeadWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  // The signed lead page has one paid action: accept the lead. Inspection-only
  // unlocks are intentionally not exposed because they would spend a credit
  // before the provider commits to the job.
  const inspectionNeeded = false
  const traceId = createTraceId('lead_accept')

  const verified = verifyProviderLeadAccessToken(token)
  if (verified.status !== 'active' || !providerLeadTokenAllowsScope(verified.payload, 'accept_lead')) {
    redirectLeadActionError(token, {
      error: 'invalid',
      errorCode: 'INVALID_SIGNED_LINK',
      action: 'accept',
      traceId,
      message: 'This secure lead link is invalid.',
      creditDeducted: false,
    })
  }

  const resolved = await resolveProviderLeadAccessToken(token)
  if (resolved.status !== 'active' || !resolved.lead) {
    redirectLeadActionError(token, {
      error: 'invalid',
      errorCode: 'INVALID_SIGNED_LINK',
      action: 'accept',
      traceId,
      message: 'This secure lead link is invalid.',
      creditDeducted: false,
    })
  }

  const lead = resolved.lead
  const leadExpired = lead.status === 'EXPIRED' || Boolean(lead.expiresAt && lead.expiresAt <= new Date())
  const leadDeclined = lead.status === 'DECLINED'
  const leadAccepted = lead.status === 'ACCEPTED'
  if (leadExpired || leadAccepted || leadDeclined) {
    redirectLeadActionError(token, {
      error: 'closed',
      errorCode: leadExpired ? 'LEAD_EXPIRED' : leadDeclined ? 'LEAD_ALREADY_DECLINED' : 'LEAD_ALREADY_ACCEPTED',
      action: 'accept',
      traceId,
      message: leadExpired
        ? 'This lead has expired and can no longer be accepted. No credits were used.'
        : leadDeclined
        ? 'You have already declined this lead. No credits were used.'
        : 'This lead has already been accepted or closed. No credits were used.',
      creditDeducted: false,
    })
  }

  const { acceptLead } = await import('@/lib/matching-engine')
  let result
  try {
    result = await acceptLead({ leadId: lead.id, providerId: lead.providerId, inspectionNeeded, source: 'pwa' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    console.error('[leads/access] accept lead action failed', {
      trace_id: traceId,
      lead_id: lead.id,
      lead_ref: lead.id.slice(-8).toUpperCase(),
      job_ref: lead.jobRequestId.slice(-8).toUpperCase(),
      provider_id: lead.providerId,
      source: 'pwa_signed_link',
      action: 'accept',
      error_code: 'UNKNOWN_LEAD_ACTION_ERROR',
      error: safeErrorMessage(error),
    })
    redirectLeadActionError(token, {
      error: 'accept_failed',
      errorCode: 'UNKNOWN_LEAD_ACTION_ERROR',
      action: 'accept',
      traceId,
      message: 'We could not process this acceptance.',
      creditDeducted: false,
    })
  }

  if (!result.ok) {
    if (result.reason === 'INSUFFICIENT_CREDITS') {
      redirectLeadActionError(token, {
        error: 'credits',
        errorCode: 'INSUFFICIENT_CREDITS',
        action: 'accept',
        traceId,
        message: 'This lead requires 1 Plug A Pro provider credit to accept.',
        creditDeducted: false,
      })
    }
    if (result.reason === 'PROVIDER_NOT_APPROVED') {
      redirectLeadActionError(token, {
        error: 'approval',
        errorCode: 'PROVIDER_NOT_APPROVED',
        action: 'accept',
        traceId,
        message: 'Your provider application must be approved before you can accept leads.',
        creditDeducted: false,
      })
    }
    redirectLeadActionError(token, {
      error: result.reason.toLowerCase(),
      errorCode: acceptErrorCode(result.reason),
      action: 'accept',
      traceId,
      message: 'This lead could not be accepted.',
      creditDeducted: false,
    })
  }

  const query = new URLSearchParams({ accepted: '1', actionTraceId: traceId })
  if (result.currentCreditBalance != null) {
    query.set('remainingBalance', String(result.currentCreditBalance))
  }
  if (result.alreadyUnlocked) {
    query.set('alreadyAccepted', '1')
  }
  redirect(`/leads/access/${encodeURIComponent(token)}?${query.toString()}`)
}

async function declineLeadWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const traceId = createTraceId('lead_decline')

  const verified = verifyProviderLeadAccessToken(token)
  if (verified.status !== 'active' || !providerLeadTokenAllowsScope(verified.payload, 'decline_lead')) {
    redirectLeadActionError(token, {
      error: 'invalid',
      errorCode: 'INVALID_SIGNED_LINK',
      action: 'decline',
      traceId,
      message: 'This secure lead link is invalid.',
      creditDeducted: false,
    })
  }

  const resolved = await resolveProviderLeadAccessToken(token)
  if (resolved.status !== 'active' || !resolved.lead) {
    redirectLeadActionError(token, {
      error: 'invalid',
      errorCode: 'INVALID_SIGNED_LINK',
      action: 'decline',
      traceId,
      message: 'This secure lead link is invalid.',
      creditDeducted: false,
    })
  }

  const lead = resolved.lead
  if (lead.status === 'DECLINED') {
    redirect(`/leads/access/${encodeURIComponent(token)}?declined=already&actionTraceId=${encodeURIComponent(traceId)}`)
  }
  if (lead.status === 'EXPIRED' || (lead.expiresAt && lead.expiresAt <= new Date()) || lead.status === 'ACCEPTED') {
    redirectLeadActionError(token, {
      error: 'closed',
      errorCode: lead.status === 'ACCEPTED' ? 'LEAD_ALREADY_ACCEPTED' : 'LEAD_EXPIRED',
      action: 'decline',
      traceId,
      message: 'This lead can no longer be declined.',
      creditDeducted: false,
    })
  }

  const { declineLead } = await import('@/lib/matching-engine')
  let result
  try {
    result = await declineLead({ leadId: lead.id, providerId: lead.providerId })
  } catch (error) {
    if (isRedirectError(error)) throw error
    console.error('[leads/access] decline lead action failed', {
      trace_id: traceId,
      lead_id: lead.id,
      lead_ref: lead.id.slice(-8).toUpperCase(),
      job_ref: lead.jobRequestId.slice(-8).toUpperCase(),
      provider_id: lead.providerId,
      source: 'pwa_signed_link',
      action: 'decline',
      error_code: 'UNKNOWN_LEAD_ACTION_ERROR',
      error: safeErrorMessage(error),
    })
    redirectLeadActionError(token, {
      error: 'decline_failed',
      errorCode: 'UNKNOWN_LEAD_ACTION_ERROR',
      action: 'decline',
      traceId,
      message: 'We could not decline this lead.',
      creditDeducted: false,
    })
  }
  if (!result.ok) {
    const errorCode = result.reason === 'NOT_FOUND' ? 'LEAD_NOT_FOUND' : 'PROVIDER_LEAD_ACCESS_DENIED'
    console.error('[leads/access] decline lead action blocked', {
      trace_id: traceId,
      lead_id: lead.id,
      lead_ref: lead.id.slice(-8).toUpperCase(),
      job_ref: lead.jobRequestId.slice(-8).toUpperCase(),
      provider_id: lead.providerId,
      source: 'pwa_signed_link',
      action: 'decline',
      result: 'blocked',
      error_code: errorCode,
    })
    redirectLeadActionError(token, {
      error: 'decline_failed',
      errorCode,
      action: 'decline',
      traceId,
      message: 'This lead could not be declined.',
      creditDeducted: false,
    })
  }
  if (result.alreadyClosed) {
    redirect(`/leads/access/${encodeURIComponent(token)}?declined=already&actionTraceId=${encodeURIComponent(traceId)}`)
  }
  redirect(`/leads/access/${encodeURIComponent(token)}?declined=1&actionTraceId=${encodeURIComponent(traceId)}`)
}

async function saveArrivalWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const leadId = String(formData.get('leadId') ?? '')
  const arrivalDate = String(formData.get('arrivalDate') ?? '')
  const arrivalStart = String(formData.get('arrivalStart') ?? '')
  const arrivalEnd = String(formData.get('arrivalEnd') ?? '')
  const note = String(formData.get('note') ?? '')

  if (!token || !leadId || !arrivalDate || !arrivalStart) {
    redirect(`/leads/access/${encodeURIComponent(token)}?scheduleError=INVALID_ARRIVAL_TIME`)
  }

  const plannedArrivalStart = new Date(`${arrivalDate}T${arrivalStart}:00+02:00`)
  const plannedArrivalEnd = arrivalEnd ? new Date(`${arrivalDate}T${arrivalEnd}:00+02:00`) : null
  const result = await saveAcceptedLeadArrival({
    leadId,
    token,
    plannedArrivalStart,
    plannedArrivalEnd,
    note,
  })

  if (!result.ok) {
    redirect(`/leads/access/${encodeURIComponent(token)}?scheduleError=${result.reason}&scheduleMessage=${encodeURIComponent(result.message)}&traceId=${encodeURIComponent(result.traceId)}`)
  }
  redirect(`/leads/access/${encodeURIComponent(token)}?updated=arrival&traceId=${encodeURIComponent(result.traceId)}&savedAt=${encodeURIComponent(result.updatedAt.toISOString())}`)
}

async function markAcceptedActionWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const leadId = String(formData.get('leadId') ?? '')
  const action = String(formData.get('action') ?? '')
  const allowed = ['customer_contacted', 'on_the_way', 'arrived', 'started', 'completed'] as const

  if (!allowed.includes(action as (typeof allowed)[number])) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=action`)
  }

  const result = await markAcceptedLeadAction({
    leadId,
    token,
    action: action as (typeof allowed)[number],
  })
  if (!result.ok) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=${result.reason.toLowerCase()}`)
  }
  redirect(`/leads/access/${encodeURIComponent(token)}?updated=${action}`)
}

async function requestFreshLinkWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  await sendFreshAcceptedJobLink({ token }).catch(() => null)
  redirect(`/leads/access/${encodeURIComponent(token)}?fresh=sent`)
}

function deriveAcceptedStage(match: NonNullable<Awaited<ReturnType<typeof resolveProviderLeadAccessToken>>['lead']>['jobRequest']['match']) {
  if (!match) return 'Accepted'
  if (match.providerCompletedAt) return 'Completed'
  if (match.providerStartedAt) return 'In progress'
  if (match.providerArrivedAt) return 'Arrived'
  if (match.providerOnTheWayAt) return 'On the way'
  if (match.plannedArrivalStart) return 'Scheduled'
  if (match.customerContactedAt) return 'Customer contacted'
  return 'Customer contact pending'
}

function formatWindow(start: Date | null | undefined, end: Date | null | undefined) {
  if (!start) return null
  const date = format(start, 'EEE, d MMM')
  const startTime = format(start, 'HH:mm')
  return end ? `${date} · ${startTime}-${format(end, 'HH:mm')}` : `${date} · ${startTime}`
}

function arrivalInputValue(value: Date) {
  return {
    date: format(value, 'yyyy-MM-dd'),
    time: format(value, 'HH:mm'),
  }
}

function getArrivalFormDefaults(params: {
  plannedArrivalStart?: Date | null
  plannedArrivalEnd?: Date | null
  fallback: ReturnType<typeof deriveDefaultArrivalWindow>
}) {
  if (!params.plannedArrivalStart) return params.fallback
  const start = arrivalInputValue(params.plannedArrivalStart)
  const end = params.plannedArrivalEnd ? arrivalInputValue(params.plannedArrivalEnd).time : ''
  return {
    date: start.date,
    start: start.time,
    end,
  }
}

function DiagnosticRows({ details }: {
  details: Array<{ label: string; value: string | undefined | null }>
}) {
  return (
    <dl className="mt-3 space-y-1 rounded-md bg-muted/50 p-3 text-xs">
      {details.filter((item) => item.value).map((item) => (
        <div key={item.label} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="text-right font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ClosedLeadMessage({
  title,
  reason = 'This lead can no longer be accepted. New leads will be sent to you on WhatsApp as they become available.',
  diagnostics,
  children,
}: {
  title: string
  reason?: string
  diagnostics?: {
    code: DiagnosticCode
    action: string
    traceId: string
    jobRef?: string
    providerPhone?: string
  }
  children?: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center px-4">
          <p className="text-sm font-semibold">Plug A Pro</p>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">
        <div className="rounded-lg border bg-card px-4 py-5 space-y-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {reason}
          </p>
          {diagnostics && (
            <DiagnosticRows
              details={[
                { label: 'Error code', value: diagnostics.code },
                { label: 'Job ref', value: diagnostics.jobRef },
                { label: 'Provider phone', value: maskPhone(diagnostics.providerPhone) },
                { label: 'Action', value: diagnostics.action },
                { label: 'Time', value: timestamp() },
                { label: 'Trace ID', value: diagnostics.traceId },
              ]}
            />
          )}
          {children}
        </div>
      </main>
    </div>
  )
}

export default async function ProviderLeadAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{
    error?: string
    errorCode?: string
    errorMessage?: string
    action?: string
    actionTraceId?: string
    creditDeducted?: string
    accepted?: string
    alreadyAccepted?: string
    remainingBalance?: string
    confirmAccept?: string
    declined?: string
    updated?: string
    scheduleError?: string
    scheduleMessage?: string
    traceId?: string
    savedAt?: string
    editArrival?: string
  }>
}) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const resolved = await resolveProviderLeadAccessToken(token)

  if (resolved.status === 'expired') {
    const traceId = createTraceId('job')
    console.warn('[leads/access] signed lead link expired', {
      traceId,
      leadId: resolved.payload?.leadId,
      providerId: resolved.payload?.providerId,
      action: 'View Job',
    })
    return (
      <ClosedLeadMessage
        title="This job link has expired."
        reason="The secure WhatsApp job link has expired. Request a fresh link and we will send a new one to the accepted provider number."
        diagnostics={{
          code: 'JOB_LINK_EXPIRED',
          action: 'View Job',
          traceId,
          jobRef: resolved.payload?.leadId?.slice(-8).toUpperCase(),
        }}
      >
        <form action={requestFreshLinkWithToken}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" className="mt-3 w-full">Request a fresh WhatsApp link</Button>
        </form>
      </ClosedLeadMessage>
    )
  }

  if (resolved.status !== 'active' || !resolved.lead) {
    const traceId = createTraceId('job')
    console.warn('[leads/access] signed lead link invalid', {
      traceId,
      status: resolved.status,
      leadId: resolved.payload?.leadId,
      providerId: resolved.payload?.providerId,
      action: 'View Job',
    })
    return (
      <ClosedLeadMessage
        title="This job link is invalid."
        reason="We could not validate this secure WhatsApp job link. Please use the latest link sent to your provider WhatsApp number."
        diagnostics={{
          code: 'JOB_LINK_INVALID',
          action: 'View Job',
          traceId,
          jobRef: resolved.payload?.leadId?.slice(-8).toUpperCase(),
        }}
      />
    )
  }

  const lead = resolved.lead
  const jr = lead.jobRequest
  const addr = jr.address
  const customer = jr.customer
  const isAccepted = lead.status === 'ACCEPTED'
  const isDeclined = lead.status === 'DECLINED'
  const isExpired = lead.status === 'EXPIRED' || (lead.expiresAt ? lead.expiresAt < new Date() : false)
  const isOpenOffer = lead.status === 'SENT' || lead.status === 'VIEWED'
  const canRespondToLead = isOpenOffer && !isExpired
  const showExpiryCountdown = Boolean(lead.expiresAt && canRespondToLead)
  const hasAcceptedDetails = isAccepted && Boolean(lead.unlock)
  const leadRef = lead.id.slice(-8).toUpperCase()
  const jobRef = lead.jobRequestId.slice(-8).toUpperCase()

  if (((isExpired && !isAccepted) || isDeclined) && !resolvedSearchParams.declined) {
    const traceId = createTraceId('job')
    const code: DiagnosticCode = isExpired ? 'JOB_LINK_EXPIRED' : 'JOB_ACCESS_DENIED'
    console.warn('[leads/access] signed lead link closed', {
      traceId,
      leadId: lead.id,
      providerId: lead.providerId,
      leadStatus: lead.status,
      expiresAt: lead.expiresAt,
      action: 'View Job',
    })
    return (
      <ClosedLeadMessage
        title={
          isExpired
            ? 'This lead has expired.'
            : 'This lead has already been declined.'
        }
        reason="This secure job link is closed and cannot be used for job updates."
        diagnostics={{
          code,
          action: 'View Job',
          traceId,
          jobRef,
          providerPhone: lead.provider.phone,
        }}
      />
    )
  }

  if (lead.status === 'SENT') {
    await db.lead.update({ where: { id: lead.id }, data: { status: 'VIEWED' } })
  }

  const previewArea = addr
    ? [normaliseLocationDisplayName(addr.suburb), normaliseLocationDisplayName(addr.city)].filter(Boolean).join(', ')
    : 'Area on file'
  const fullArea = addr
    ? [
        'unitNumber' in addr ? addr.unitNumber : null,
        'complexName' in addr ? addr.complexName : null,
        'street' in addr ? addr.street : null,
        'addressLine1' in addr ? addr.addressLine1 : null,
        'addressLine2' in addr ? addr.addressLine2 : null,
        normaliseLocationDisplayName(addr.suburb),
        normaliseLocationDisplayName(addr.city),
        'province' in addr ? normaliseLocationDisplayName(typeof addr.province === 'string' ? addr.province : null) : null,
      ].filter(Boolean).join(', ')
    : 'Location on file'
  const preferredWindow = formatWindow(jr.requestedWindowStart, jr.requestedWindowEnd) ??
    (jr.requestedArrivalLatest ? `Before ${format(jr.requestedArrivalLatest, 'EEE, d MMM · HH:mm')}` : 'Flexible')
  const estimatedValue = jr.customerAcceptedAmount != null
    ? new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(jr.customerAcceptedAmount))
    : null
  const attachmentToken = encodeURIComponent(token)
  const acceptedStage = isAccepted ? deriveAcceptedStage(jr.match) : null
  const plannedWindow = isAccepted ? formatWindow(jr.match?.plannedArrivalStart, jr.match?.plannedArrivalEnd) : null
  const actionDisabled = Boolean(jr.match?.providerCompletedAt)
  const hasPlannedArrival = isAccepted && Boolean(jr.match?.plannedArrivalStart)
  // Job has progressed past the arrival-scheduling stage — hide the form entirely.
  const arrivalActionsDone = Boolean(
    jr.match?.providerOnTheWayAt ||
    jr.match?.providerArrivedAt ||
    jr.match?.providerStartedAt ||
    jr.match?.providerCompletedAt
  )
  const showArrivalForm = !hasPlannedArrival || resolvedSearchParams.editArrival === '1'
  const customerAvailability = getCustomerAvailabilitySummary({
    requestedWindowStart: jr.requestedWindowStart,
    requestedWindowEnd: jr.requestedWindowEnd,
    requestedArrivalLatest: jr.requestedArrivalLatest,
    description: jr.description,
  })
  const defaultArrival = getArrivalFormDefaults({
    plannedArrivalStart: jr.match?.plannedArrivalStart,
    plannedArrivalEnd: jr.match?.plannedArrivalEnd,
    fallback: deriveDefaultArrivalWindow(customerAvailability),
  })
  const providerWallet = await db.providerWallet.findUnique({
    where: { providerId: lead.providerId },
    select: { paidCreditBalance: true, promoCreditBalance: true },
  })
  const providerCreditBalance = (providerWallet?.paidCreditBalance ?? 0) + (providerWallet?.promoCreditBalance ?? 0)
  const termsUrl = getProviderTermsUrl()
  const remainingCreditBalanceAfterAccept = providerCreditBalance - LEAD_UNLOCK_COST_CREDITS
  const hasEnoughCredits = providerCreditBalance >= LEAD_UNLOCK_COST_CREDITS
  const acceptedRemainingBalance =
    resolvedSearchParams.remainingBalance != null && Number.isFinite(Number(resolvedSearchParams.remainingBalance))
      ? Number(resolvedSearchParams.remainingBalance)
      : providerCreditBalance
  const confirmingAccept = resolvedSearchParams.confirmAccept === '1' && canRespondToLead
  const supportWhatsAppDigits = process.env.SUPPORT_WHATSAPP_NUMBER?.replace(/\D/g, '')
  const backToWhatsAppHref = supportWhatsAppDigits
    ? `https://wa.me/${supportWhatsAppDigits}?text=${encodeURIComponent(`Hi, I declined lead ${jobRef}.`)}`
    : null

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center px-4">
          <p className="text-sm font-semibold">Plug A Pro</p>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 pb-36 space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isAccepted ? 'Accepted Job' : 'New Lead'} · Lead Ref {leadRef}
          </p>
          <h1 className="text-xl font-semibold">{jr.title || jr.category}</h1>
          {acceptedStage && (
            <p className="text-sm text-muted-foreground">Status: {acceptedStage}</p>
          )}
        </div>

        {showExpiryCountdown && lead.expiresAt && (
          <div className="tone-warning rounded-lg border px-4 py-3 text-sm">
            Expires {formatDistanceToNow(lead.expiresAt, { addSuffix: true })} · {format(lead.expiresAt, 'HH:mm, d MMM')}
          </div>
        )}

        {isAccepted && (
          <div className="tone-success rounded-lg border px-4 py-3 text-sm space-y-1">
            <p className="font-semibold">Job assigned to you</p>
            {jr.match?.createdAt && (
              <p>Accepted {format(jr.match.createdAt, 'HH:mm, d MMM yyyy')} · 1 credit used.</p>
            )}
            <p>Next step: contact the customer and confirm your arrival time below.</p>
          </div>
        )}

        {resolvedSearchParams.accepted === '1' && (
          <div className="tone-success rounded-lg border px-4 py-3 text-sm">
            <p className="font-medium">Lead accepted.</p>
            {resolvedSearchParams.alreadyAccepted === '1' ? (
              <p className="mt-1">You had already accepted this lead — no credit was used on this action.</p>
            ) : (
              <p className="mt-1">
                1 credit used. Balance remaining: {acceptedRemainingBalance} credit{acceptedRemainingBalance === 1 ? '' : 's'}.
              </p>
            )}
            <p className="mt-1">Full customer and job details are now available.</p>
            {resolvedSearchParams.actionTraceId ? (
              <p className="mt-2 text-xs">Trace ID: {resolvedSearchParams.actionTraceId}</p>
            ) : null}
          </div>
        )}

        {resolvedSearchParams.declined === '1' && (
          <div className="tone-success rounded-lg border px-4 py-3 text-sm">
            <p className="font-medium">Lead declined</p>
            <p className="mt-1">We will send it to another provider.</p>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide">
              Ref: {jobRef}
            </p>
            {resolvedSearchParams.actionTraceId ? (
              <p className="mt-2 text-xs">Trace ID: {resolvedSearchParams.actionTraceId}</p>
            ) : null}
            <div className="mt-4 grid gap-2">
              {backToWhatsAppHref ? (
                <Button asChild size="sm" className="bg-[var(--tone-success-fg)] hover:opacity-90 text-white">
                  <a href={backToWhatsAppHref}>Back to WhatsApp</a>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline" className="bg-background">
                <Link href="/provider/leads">Available Jobs</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="bg-background">
                <Link href="/provider">Main Menu</Link>
              </Button>
            </div>
          </div>
        )}

        {resolvedSearchParams.declined === 'already' && (
          <div className="tone-warning rounded-lg border px-4 py-3 text-sm">
            <p className="font-medium">Lead already closed</p>
            <p className="mt-1">This lead has already expired or been taken. No action was needed.</p>
            <div className="mt-4 grid gap-2">
              {backToWhatsAppHref ? (
                <Button asChild size="sm" className="bg-[var(--tone-warning-fg)] hover:opacity-90 text-white">
                  <a href={backToWhatsAppHref}>Back to WhatsApp</a>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline" className="bg-background">
                <Link href="/provider/leads">Available Jobs</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="bg-background">
                <Link href="/provider">Main Menu</Link>
              </Button>
            </div>
          </div>
        )}

        {resolvedSearchParams.updated === 'arrival' && (
          <div className="tone-success rounded-lg border px-4 py-3 text-sm">
            <p className="font-medium">Arrival time saved.</p>
            <p className="mt-1">
              Customer has been notified on WhatsApp.
            </p>
            {resolvedSearchParams.savedAt ? (
              <p className="mt-1 text-xs">
                Last updated: {format(new Date(resolvedSearchParams.savedAt), 'HH:mm, d MMM yyyy')}
              </p>
            ) : null}
            {resolvedSearchParams.traceId ? (
              <p className="mt-2 text-xs">Trace ID: {resolvedSearchParams.traceId}</p>
            ) : null}
          </div>
        )}

        {resolvedSearchParams.scheduleError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <p className="font-medium">Could not save arrival time.</p>
            <p className="mt-1">
              Reason: {resolvedSearchParams.scheduleMessage ?? 'The selected arrival window could not be saved.'}
            </p>
            <p className="mt-2 text-xs">
              Error code: {resolvedSearchParams.scheduleError}
              {resolvedSearchParams.traceId ? ` · Trace ID: ${resolvedSearchParams.traceId}` : ''}
            </p>
          </div>
        )}

        {resolvedSearchParams.error === 'credits' && (
          <div className="tone-warning rounded-lg border px-4 py-3 text-sm">
            <p className="font-medium">You need 1 Plug A Pro provider credit to accept this customer-selected job.</p>
            <p className="mt-1">
              Your current credits balance is {providerCreditBalance} credit{providerCreditBalance === 1 ? '' : 's'}.
            </p>
            <p className="mt-1">Please top up in the Worker Portal to continue. Customer contact and exact address details remain hidden.</p>
            {resolvedSearchParams.actionTraceId ? (
              <p className="mt-2 text-xs">Error code: INSUFFICIENT_CREDITS · Trace ID: {resolvedSearchParams.actionTraceId}</p>
            ) : (
              <p className="mt-2 text-xs">Error code: INSUFFICIENT_CREDITS</p>
            )}
          </div>
        )}

        {resolvedSearchParams.error === 'inactive' && (
          <div className="tone-warning rounded-lg border px-4 py-3 text-sm">
            <p>Your provider profile is not active, so you cannot accept leads right now.</p>
            <p className="mt-2 text-xs">
              Error code: PROVIDER_NOT_ACTIVE
              {resolvedSearchParams.actionTraceId ? ` · Trace ID: ${resolvedSearchParams.actionTraceId}` : ''}
            </p>
          </div>
        )}

        {resolvedSearchParams.error === 'approval' && (
          <div className="tone-warning rounded-lg border px-4 py-3 text-sm">
            <p>Your provider application must be approved before you can accept leads.</p>
            <p className="mt-2 text-xs">
              Error code: PROVIDER_NOT_APPROVED
              {resolvedSearchParams.actionTraceId ? ` · Trace ID: ${resolvedSearchParams.actionTraceId}` : ''}
            </p>
          </div>
        )}

        {resolvedSearchParams.error &&
          !['credits', 'inactive', 'approval'].includes(resolvedSearchParams.error) && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <p className="font-medium">
                {resolvedSearchParams.action === 'decline'
                  ? 'We could not decline this lead.'
                  : resolvedSearchParams.action === 'accept'
                    ? 'We could not process this acceptance.'
                    : 'We could not process this lead action.'}
              </p>
              <p className="mt-1">
                Reason: {resolvedSearchParams.errorMessage ?? 'The lead action could not be completed.'}
              </p>
              {resolvedSearchParams.creditDeducted === '0' ? (
                <p className="mt-1">No credit was deducted.</p>
              ) : null}
              <p className="mt-2 text-xs">
                Error code: {resolvedSearchParams.errorCode ?? 'UNKNOWN_LEAD_ACTION_ERROR'}
                {resolvedSearchParams.actionTraceId ? ` · Trace ID: ${resolvedSearchParams.actionTraceId}` : ''}
              </p>
            </div>
          )}

        {canRespondToLead && (
          <div className="rounded-lg border bg-card px-4 py-3 text-sm">
            <p className="font-medium">Lead preview</p>
            <p className="mt-1 text-muted-foreground">
              Customer contact, exact street address, unit, complex and access details are hidden until you accept this customer-selected job.
            </p>
            <p className="mt-2">
              Accepting this customer-selected job uses {LEAD_UNLOCK_COST_CREDITS} credit{LEAD_UNLOCK_COST_CREDITS === 1 ? '' : 's'} (1 credit = R50).
              Your current credits balance is {providerCreditBalance} credit{providerCreditBalance === 1 ? '' : 's'}.
            </p>
          </div>
        )}

        {confirmingAccept && (
          <div className="tone-info rounded-lg border px-4 py-4 text-sm">
            <p className="font-semibold">Confirm lead acceptance</p>
            {hasEnoughCredits ? (
              <>
                <p className="mt-1">
                  Accepting this customer-selected job uses {LEAD_UNLOCK_COST_CREDITS} credit{LEAD_UNLOCK_COST_CREDITS === 1 ? '' : 's'} (1 credit = R50).
                  Your current credits balance is {providerCreditBalance}. After accepting, your balance will be {remainingCreditBalanceAfterAccept}.
                </p>
                <p className="mt-1">
                  Full customer details will be released only after acceptance succeeds. Credits use follows the{' '}
                  <Link href={termsUrl} className="font-medium underline underline-offset-4">
                    provider credits terms and rules
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <p className="mt-1">
                  You need {LEAD_UNLOCK_COST_CREDITS} credit{LEAD_UNLOCK_COST_CREDITS === 1 ? '' : 's'} to accept this customer-selected job.
                  Your current credits balance is {providerCreditBalance}.
                </p>
                <p className="mt-1">Top up before accepting. No customer contact or exact address details have been released.</p>
              </>
            )}
          </div>
        )}

        <div className="rounded-lg border bg-card divide-y">
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Category</p>
            <p className="font-medium">{jr.category}</p>
          </div>
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Lead reference</p>
            <p className="font-medium">{leadRef}</p>
          </div>
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Job reference</p>
            <p className="font-medium">{jobRef}</p>
          </div>
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Current status</p>
            <p className="font-medium">{acceptedStage ?? lead.status.replaceAll('_', ' ').toLowerCase()}</p>
          </div>
          {hasAcceptedDetails && lead.unlock && (
            <div className="px-4 py-3 space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Credit spend</p>
              <p className="font-medium">
                {lead.unlock.creditsCharged} credit{lead.unlock.creditsCharged === 1 ? '' : 's'} used
              </p>
              <p className="text-sm text-muted-foreground">
                Accepted {format(lead.unlock.unlockedAt, 'HH:mm, d MMM yyyy')}
              </p>
            </div>
          )}
          {isAccepted && jr.match?.createdAt && (
            <div className="px-4 py-3 space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Accepted</p>
              <p className="font-medium">{format(jr.match.createdAt, 'HH:mm, d MMM yyyy')}</p>
            </div>
          )}
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {hasAcceptedDetails ? 'Full location' : 'Area preview'}
            </p>
            <p className="font-medium">{hasAcceptedDetails ? fullArea : previewArea}</p>
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
          {hasAcceptedDetails && customer && (
            <div className="px-4 py-3 space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Customer contact</p>
              <p className="font-medium">{customer.name}</p>
              <p className="text-sm text-muted-foreground">{customer.phone}</p>
            </div>
          )}
          {isAccepted && plannedWindow && (
            <div className="px-4 py-3 space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Planned arrival</p>
              <p className="font-medium">{plannedWindow}</p>
              {jr.match?.plannedArrivalNote && (
                <p className="text-sm text-muted-foreground">{jr.match.plannedArrivalNote}</p>
              )}
            </div>
          )}
          {jr.description && (
            <div className="px-4 py-3 space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {hasAcceptedDetails ? 'Description' : 'Short description'}
              </p>
              <p className="text-sm whitespace-pre-line">
                {hasAcceptedDetails || jr.description.length <= 180
                  ? jr.description
                  : `${jr.description.slice(0, 180).trim()}...`}
              </p>
            </div>
          )}
          {jr.attachments.length > 0 && (
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Customer photos</p>
              <div className="grid grid-cols-2 gap-2">
                {jr.attachments.map((photo) => {
                  const src = `/api/attachments/${photo.id}?leadToken=${attachmentToken}`
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
          {!hasAcceptedDetails && (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              Accept this customer-selected job for {LEAD_UNLOCK_COST_CREDITS} Plug A Pro provider credit (1 credit = R50) to view customer contact details, exact address, and access instructions.
            </div>
          )}
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Received</p>
            <p className="text-sm text-muted-foreground">
              {format(lead.sentAt, 'HH:mm, d MMM yyyy')}
            </p>
          </div>
        </div>

        {isAccepted && hasPlannedArrival && !showArrivalForm && !arrivalActionsDone && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div>
              <h2 className="text-base font-semibold">Arrival time confirmed</h2>
              <p className="text-sm text-muted-foreground">Customer has been notified on WhatsApp.</p>
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm space-y-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scheduled for</p>
                <p className="mt-1 font-medium">{plannedWindow}</p>
              </div>
              {jr.match?.plannedArrivalNote && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Note to customer</p>
                  <p className="mt-1">{jr.match.plannedArrivalNote}</p>
                </div>
              )}
            </div>
            <Button asChild variant="outline" size="sm" className="bg-background">
              <Link href={`/leads/access/${encodeURIComponent(token)}?editArrival=1`}>Change arrival time</Link>
            </Button>
          </div>
        )}

        {isAccepted && showArrivalForm && !arrivalActionsDone && (
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div>
              <h2 className="text-base font-semibold">
                {hasPlannedArrival ? 'Update arrival time' : 'Confirm arrival time'}
              </h2>
              <p className="text-sm text-muted-foreground">
                The customer will receive this schedule update on WhatsApp.
              </p>
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Customer requested availability
              </p>
              <p className="mt-1 font-medium">{customerAvailability.label}</p>
              <p className="mt-1 text-muted-foreground">
                {customerAvailability.helper}
              </p>
              {customerAvailability.allowedWindows.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Allowed: {customerAvailability.allowedWindows.join(', ')}
                </p>
              )}
            </div>
            <form action={saveArrivalWithToken} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="leadId" value={lead.id} />
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Arrival date</span>
                <input
                  name="arrivalDate"
                  type="date"
                  required
                  defaultValue={defaultArrival.date}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">From</span>
                  <input
                    name="arrivalStart"
                    type="time"
                    required
                    defaultValue={defaultArrival.start}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">To</span>
                  <input
                    name="arrivalEnd"
                    type="time"
                    defaultValue={defaultArrival.end}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Note to customer</span>
                <textarea name="note" rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Optional arrival note" />
              </label>
              <ArrivalSubmitButton disabled={actionDisabled} />
            </form>
            <div className="tone-warning rounded-md border px-3 py-3 text-sm">
              <p className="font-medium">Need a time outside this availability?</p>
              <p className="mt-1">
                Outside requested availability. Please contact the customer before scheduling this time.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3 bg-background">
                <a href={`/api/provider/leads/${lead.id}/contact-customer?leadToken=${encodeURIComponent(token)}`}>
                  Propose different time
                </a>
              </Button>
            </div>
          </div>
        )}

        {isAccepted && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div>
              <h2 className="text-base font-semibold">Quick job updates</h2>
              <p className="text-sm text-muted-foreground">
                These updates notify the customer and are logged on the ticket.
              </p>
            </div>
            <div className="grid gap-2">
              <form action={markAcceptedActionWithToken}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="action" value="customer_contacted" />
                <Button type="submit" variant="outline" className="w-full" disabled={Boolean(jr.match?.customerContactedAt) || actionDisabled}>
                  Mark customer contacted
                </Button>
              </form>
              <form action={markAcceptedActionWithToken}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="action" value="on_the_way" />
                <Button type="submit" className="w-full" disabled={Boolean(jr.match?.providerOnTheWayAt) || actionDisabled}>
                  Mark on the way
                </Button>
              </form>
              <form action={markAcceptedActionWithToken}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="action" value="arrived" />
                <Button type="submit" className="w-full" disabled={Boolean(jr.match?.providerArrivedAt) || actionDisabled}>
                  Mark arrived
                </Button>
              </form>
              <form action={markAcceptedActionWithToken}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="action" value="started" />
                <Button type="submit" variant="outline" className="w-full" disabled={Boolean(jr.match?.providerStartedAt) || actionDisabled}>
                  Start job
                </Button>
              </form>
              <form action={markAcceptedActionWithToken}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="action" value="completed" />
                <Button type="submit" variant="outline" className="w-full" disabled={actionDisabled}>
                  Complete job
                </Button>
              </form>
            </div>
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 px-4 py-4 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-lg space-y-2">
          {isAccepted ? (
            <>
              <Button asChild size="lg" className="w-full">
                <a href={`/api/provider/leads/${lead.id}/contact-customer?leadToken=${encodeURIComponent(token)}`}>
                  Contact Customer
                </a>
              </Button>
              {jr.match?.id && (
                <div className="rounded-md border bg-card px-3 py-3 text-sm text-muted-foreground">
                  <p>Please sign in to manage all jobs, build quotes, or update your profile.</p>
                  <Button asChild size="lg" variant="outline" className="mt-3 w-full">
                    <a href={`/provider/quotes/${jr.match.id}`}>Sign in</a>
                  </Button>
                </div>
              )}
            </>
          ) : isDeclined ? (
            <>
              {backToWhatsAppHref ? (
                <Button asChild size="lg" className="w-full">
                  <a href={backToWhatsAppHref}>Back to WhatsApp</a>
                </Button>
              ) : null}
              <Button asChild size="lg" variant={backToWhatsAppHref ? 'outline' : 'default'} className="w-full">
                <Link href="/provider/leads">Available Jobs</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full">
                <Link href="/provider">Main Menu</Link>
              </Button>
            </>
          ) : canRespondToLead && !confirmingAccept ? (
            <>
              <Button asChild size="lg" className="w-full">
                <Link href={`/leads/access/${encodeURIComponent(token)}?confirmAccept=1`}>
                  Accept job — uses {LEAD_UNLOCK_COST_CREDITS} credit{LEAD_UNLOCK_COST_CREDITS === 1 ? '' : 's'}
                </Link>
              </Button>
            </>
          ) : canRespondToLead && confirmingAccept && hasEnoughCredits ? (
            <form action={acceptLeadWithToken}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="inspectionNeeded" value="false" />
              <LeadActionSubmitButton size="lg" className="w-full" pendingLabel="Accepting lead...">
                Confirm accept — use {LEAD_UNLOCK_COST_CREDITS} credit{LEAD_UNLOCK_COST_CREDITS === 1 ? '' : 's'}
              </LeadActionSubmitButton>
            </form>
          ) : canRespondToLead && confirmingAccept ? (
            <>
              <Button asChild size="lg" className="w-full">
                <Link href="/provider/credits">Top up credits</Link>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                You need {LEAD_UNLOCK_COST_CREDITS} credit{LEAD_UNLOCK_COST_CREDITS === 1 ? '' : 's'} to accept this customer-selected job.
              </p>
            </>
          ) : null}

          {canRespondToLead && (
            <>
              {confirmingAccept && (
                <Button asChild size="lg" variant="outline" className="w-full">
                  <Link href={`/leads/access/${encodeURIComponent(token)}`}>Back to preview</Link>
                </Button>
              )}
            </>
          )}

          {canRespondToLead && !confirmingAccept && (
            <form action={declineLeadWithToken}>
              <input type="hidden" name="token" value={token} />
              <LeadActionSubmitButton
                size="lg"
                variant="ghost"
                className="w-full text-destructive hover:text-destructive"
                pendingLabel="Declining..."
              >
                Decline
              </LeadActionSubmitButton>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
