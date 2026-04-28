export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { format, formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { getCategoryPolicy } from '@/lib/service-category-policy'
import { db } from '@/lib/db'
import { resolveProviderLeadAccessToken } from '@/lib/provider-lead-access'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import {
  markAcceptedLeadAction,
  saveAcceptedLeadArrival,
  sendFreshAcceptedJobLink,
} from '@/lib/accepted-job-actions'
import { createTraceId, maskPhone, timestamp, type DiagnosticCode } from '@/lib/support-diagnostics'

async function acceptLeadWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const inspectionNeeded = formData.get('inspectionNeeded') === 'true'

  const resolved = await resolveProviderLeadAccessToken(token)
  if (resolved.status !== 'active' || !resolved.lead) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=invalid`)
  }

  const lead = resolved.lead
  if ((lead.expiresAt && lead.expiresAt <= new Date()) || lead.status === 'ACCEPTED' || lead.status === 'DECLINED') {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=closed`)
  }

  const { acceptLead } = await import('@/lib/matching-engine')
  const result = await acceptLead({ leadId: lead.id, providerId: lead.providerId, inspectionNeeded })

  if (!result.ok) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=${result.reason.toLowerCase()}`)
  }

  redirect(`/leads/access/${encodeURIComponent(token)}?accepted=1`)
}

async function declineLeadWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')

  const resolved = await resolveProviderLeadAccessToken(token)
  if (resolved.status !== 'active' || !resolved.lead) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=invalid`)
  }

  const lead = resolved.lead
  if ((lead.expiresAt && lead.expiresAt <= new Date()) || lead.status === 'ACCEPTED' || lead.status === 'DECLINED') {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=closed`)
  }

  const { declineLead } = await import('@/lib/matching-engine')
  await declineLead({ leadId: lead.id, providerId: lead.providerId })
  redirect(`/leads/access/${encodeURIComponent(token)}?declined=1`)
}

function dateForArrivalChoice(choice: string, specificDate: string) {
  const now = new Date()
  const date = new Date(now)
  if (choice === 'tomorrow') date.setDate(date.getDate() + 1)
  if (choice === 'specific' && specificDate) {
    return specificDate
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

async function saveArrivalWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const leadId = String(formData.get('leadId') ?? '')
  const arrivalDay = String(formData.get('arrivalDay') ?? 'today')
  const arrivalDate = String(formData.get('arrivalDate') ?? '')
  const arrivalStart = String(formData.get('arrivalStart') ?? '')
  const arrivalEnd = String(formData.get('arrivalEnd') ?? '')
  const note = String(formData.get('note') ?? '')

  if (!token || !leadId || !arrivalStart) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=arrival`)
  }

  const date = dateForArrivalChoice(arrivalDay, arrivalDate)
  const plannedArrivalStart = new Date(`${date}T${arrivalStart}:00+02:00`)
  const plannedArrivalEnd = arrivalEnd ? new Date(`${date}T${arrivalEnd}:00+02:00`) : null
  const result = await saveAcceptedLeadArrival({
    leadId,
    token,
    plannedArrivalStart,
    plannedArrivalEnd,
    note,
  })

  if (!result.ok) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=${result.reason.toLowerCase()}`)
  }
  redirect(`/leads/access/${encodeURIComponent(token)}?updated=arrival`)
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
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
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
  const isExpired = lead.expiresAt ? lead.expiresAt < new Date() : false
  const isAccepted = lead.status === 'ACCEPTED'
  const isDeclined = lead.status === 'DECLINED'

  if ((isExpired && !isAccepted) || isDeclined) {
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
          jobRef: lead.jobRequestId.slice(-8).toUpperCase(),
          providerPhone: lead.provider.phone,
        }}
      />
    )
  }

  if (lead.status === 'SENT') {
    await db.lead.update({ where: { id: lead.id }, data: { status: 'VIEWED' } })
  }

  const area = addr
    ? [addr.street, addr.suburb, addr.city, addr.province].filter(Boolean).join(', ')
    : 'Location on file'
  const categoryPolicy = getCategoryPolicy(jr.category)
  const showInspectionOption = !categoryPolicy.bookingOnAssignment
  const attachmentToken = encodeURIComponent(token)
  const acceptedStage = isAccepted ? deriveAcceptedStage(jr.match) : null
  const plannedWindow = isAccepted ? formatWindow(jr.match?.plannedArrivalStart, jr.match?.plannedArrivalEnd) : null
  const actionDisabled = Boolean(jr.match?.providerCompletedAt)

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
            New Lead · {lead.id.slice(-8).toUpperCase()}
          </p>
          <h1 className="text-xl font-semibold">{jr.title || jr.category}</h1>
          {acceptedStage && (
            <p className="text-sm text-muted-foreground">Status: {acceptedStage}</p>
          )}
        </div>

        {lead.expiresAt && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Expires {formatDistanceToNow(lead.expiresAt, { addSuffix: true })} · {format(lead.expiresAt, 'HH:mm, d MMM')}
          </div>
        )}

        <div className="rounded-lg border bg-card divide-y">
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Category</p>
            <p className="font-medium">{jr.category}</p>
          </div>
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Location</p>
            <p className="font-medium">{area}</p>
          </div>
          {isAccepted && (
            <div className="px-4 py-3 space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Customer contact</p>
              <p className="font-medium">{jr.customer.name}</p>
              <p className="text-sm text-muted-foreground">{jr.customer.phone}</p>
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
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Description</p>
              <p className="text-sm whitespace-pre-line">{jr.description}</p>
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
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Received</p>
            <p className="text-sm text-muted-foreground">
              {format(lead.sentAt, 'HH:mm, d MMM yyyy')}
            </p>
          </div>
        </div>

        {isAccepted && (
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div>
              <h2 className="text-base font-semibold">Update arrival time</h2>
              <p className="text-sm text-muted-foreground">
                The customer will receive this schedule update on WhatsApp.
              </p>
            </div>
            <form action={saveArrivalWithToken} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="leadId" value={lead.id} />
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Day</span>
                <select name="arrivalDay" className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="specific">Specific date</option>
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Specific date</span>
                <input name="arrivalDate" type="date" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">From</span>
                  <input name="arrivalStart" type="time" required className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">To</span>
                  <input name="arrivalEnd" type="time" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Note to customer</span>
                <textarea name="note" rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Optional arrival note" />
              </label>
              <Button type="submit" className="w-full" disabled={actionDisabled}>
                Save arrival &amp; mark scheduled
              </Button>
            </form>
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
                <Button asChild size="lg" variant="outline" className="w-full">
                  <a href={`/provider/quotes/${jr.match.id}`}>Build Quote</a>
                </Button>
              )}
            </>
          ) : (
            <form action={acceptLeadWithToken}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="inspectionNeeded" value="false" />
              <Button type="submit" size="lg" className="w-full">
                Accept &amp; Build Quote
              </Button>
            </form>
          )}

          {!isAccepted && showInspectionOption && (
            <form action={acceptLeadWithToken}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="inspectionNeeded" value="true" />
              <Button type="submit" size="lg" variant="outline" className="w-full">
                Inspection First
              </Button>
            </form>
          )}

          {!isAccepted && (
            <form action={declineLeadWithToken}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit" size="lg" variant="ghost" className="w-full text-destructive hover:text-destructive">
                Decline
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
