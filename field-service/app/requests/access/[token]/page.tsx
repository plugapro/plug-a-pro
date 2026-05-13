export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buildMetadata } from '@/lib/metadata'
import { resolveJobRequestAccessToken } from '@/lib/job-request-access'
import { buildCustomerRequestTicketViewModel } from '@/lib/customer-request-ticket-view-model'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ProviderTrustNote } from '@/components/shared/provider-trust-note'
import { ProviderTrustSignals } from '@/components/shared/provider-trust-signals'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildProviderTrustSignals } from '@/lib/provider-trust'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { buildClientPwaJobTrackingSteps } from '@/lib/client-pwa-job-tracking'
import {
  cancelRequestFromShortlist,
  requestMoreShortlistOptions,
  selectShortlistedProviderForRequest,
} from '@/lib/customer-shortlists'
import {
  sendRequestToShortlistedProviders,
  shortlistProviderForCustomerReview,
} from '@/lib/review-first'
import {
  selectCustomerRequestMatchingMode,
  type CustomerMatchingMode,
} from '@/lib/request-matching-mode'

export const metadata = buildMetadata({ title: 'Ticket Details', noIndex: true })

async function selectShortlistProvider(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const shortlistItemId = String(formData.get('shortlistItemId') ?? '')
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status !== 'active' || resolved.jobRequest?.id !== requestId) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await selectShortlistedProviderForRequest({ requestId, shortlistItemId })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?selection=provider-confirming`)
}

async function askForMoreShortlistOptions(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status !== 'active' || resolved.jobRequest?.id !== requestId) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await requestMoreShortlistOptions({ requestId })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=more-options-failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?selection=more-options`)
}

async function cancelRequestAction(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status !== 'active' || resolved.jobRequest?.id !== requestId) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await cancelRequestFromShortlist({ requestId })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=cancel-failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?selection=cancelled`)
}

async function sendReviewShortlistFromToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status !== 'active' || resolved.jobRequest?.id !== requestId) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await sendRequestToShortlistedProviders({
      requestId,
      customerId: resolved.jobRequest.customerId,
    })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=send-shortlist-failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?selection=sent-to-shortlist`)
}

async function chooseMatchingModeFromToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const mode = String(formData.get('mode') ?? '') as CustomerMatchingMode
  const resolved = await resolveJobRequestAccessToken(token)

  if (
    resolved.status !== 'active' ||
    resolved.jobRequest?.id !== requestId ||
    (mode !== 'quick_match' && mode !== 'review_first')
  ) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await selectCustomerRequestMatchingMode({
      requestId,
      customerId: resolved.jobRequest.customerId,
      mode,
    })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=matching-mode-failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?view=request_submitted`)
}

async function shortlistReviewProviderFromToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const providerId = String(formData.get('providerId') ?? '')
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status !== 'active' || resolved.jobRequest?.id !== requestId || !providerId) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await shortlistProviderForCustomerReview({
      requestId,
      customerId: resolved.jobRequest.customerId,
      providerId,
    })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=shortlist-failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?selection=shortlisted`)
}

function formatCurrency(amount: number | null) {
  if (amount == null) return 'Not provided'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount)
}

function formatDateTime(value: Date | null) {
  if (!value) return 'Not provided'
  return value.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function TicketAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ intent?: string; provider?: string; selection?: string; view?: string; batch?: string }>
}) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const reviewBatch = Math.max(1, Number.parseInt(resolvedSearchParams.batch ?? '1', 10) || 1)
  const ticketVm = await buildCustomerRequestTicketViewModel({
    token,
    intendedScreen: resolvedSearchParams.view ?? resolvedSearchParams.intent ?? null,
    reviewBatch,
  })

  if (ticketVm.kind !== 'ready') {
    const expired = ticketVm.reason === 'expired'
    const invalid = ticketVm.reason === 'invalid'
    const code = expired ? 'TICKET_LINK_EXPIRED' : invalid ? 'TICKET_LINK_INVALID' : 'TICKET_LOOKUP_FAILED'
    const title = expired ? 'This request link has expired.' : "We couldn't open this request link."
    const body = expired
      ? 'This secure request link is time-limited. Open the latest WhatsApp message to get a fresh link, or start a new request below.'
      : 'We could not verify this request link. It may be old, malformed, or no longer available.'
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
        <Card>
          <CardContent className="space-y-3 px-4 py-5 text-sm">
            <p className="font-semibold">{title}</p>
            <p className="text-muted-foreground">
              {body}
            </p>
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              <span className="mr-2 font-semibold">Code:</span>{code}
              <br />
              <span className="mr-2 font-semibold">Ref:</span>{ticketVm.traceId}
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-2">
          <Button asChild variant="outline" className="w-full">
            <a href="https://wa.me/" target="_blank" rel="noopener noreferrer">Return to WhatsApp</a>
          </Button>
          <Button asChild className="w-full">
            <Link href="/services">Start a new request</Link>
          </Button>
          <Button asChild className="w-full">
            <Link href="/sign-in">Sign in to view your tickets</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    )
  }

  const destination = ticketVm.destination
  const jobRequest = destination.request
  if (!jobRequest) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
        <Card>
          <CardContent className="space-y-3 px-4 py-5 text-sm">
            <p className="font-semibold">We could not load this request.</p>
            <p className="text-muted-foreground">
              This request may no longer be available from this link. Please use your latest WhatsApp update.
            </p>
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              <span className="mr-2 font-semibold">Code:</span>TICKET_REQUEST_MISSING
              <br />
              <span className="mr-2 font-semibold">Ref:</span>{ticketVm.traceId}
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-2">
          <Button asChild className="w-full">
            <Link href="/services">Start a new request</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    )
  }
  const shortlist = ticketVm.shortlist
  const profileItem = shortlist?.items.find((item) => item.providerId === resolvedSearchParams.provider) ?? null
  const selectedShortlistItem =
    shortlist?.items.find((item) => Boolean(item.customerSelectedAt) || jobRequest.selectedLeadInviteId === item.leadInviteId) ?? null
  const match = jobRequest.match
  const canRequestMoreOptions = destination.allowedActions.includes('request_more_options')
  const canCancelRequest = destination.allowedActions.includes('cancel_request')
  const isReviewFirstFlow =
    (jobRequest.status === 'PENDING_VALIDATION' || jobRequest.status === 'MATCHING') &&
    jobRequest.assignmentMode === 'OPS_REVIEW' &&
    Boolean(jobRequest.latestDispatchDecisionId)
  const isReviewFirstPending = isReviewFirstFlow && !Boolean(jobRequest.latestDispatchDecisionId)
  const reviewCandidates = ticketVm.reviewCandidates
  const reviewShortlist = ticketVm.reviewShortlist
  const reviewShortlistProviders = reviewShortlist?.providers ?? []
  const isReviewFirstSent = reviewShortlistProviders.some((provider) =>
    ['SENT', 'VIEWED', 'INTERESTED'].includes(provider.status),
  )
  const isReviewFirstSending = reviewShortlistProviders.some((provider) => provider.status === 'SEND_PENDING')
  const hasReviewFirstSendFailure = reviewShortlistProviders.some((provider) => provider.status === 'SEND_FAILED')
  const reviewShortlistedProviderIds = new Set(
    reviewShortlistProviders.map((provider) => provider.providerId),
  )
  const latestQuote = match?.quotes[0] ?? null
  const booking = match?.booking ?? null
  const provider = match?.provider ?? null
  const currentJobStatus = booking?.job?.status ?? null
  const expectedArrivalAt = booking?.job?.scheduledArrivalAt ?? selectedShortlistItem?.estimatedArrivalAt ?? null
  const trackingSteps = booking?.job
    ? buildClientPwaJobTrackingSteps({
        status: currentJobStatus,
        arrivalTimeConfirmedAt: booking.job.arrivalTimeConfirmedAt,
      })
    : []
  const supportHref = 'https://plugapro.co.za/contact'
  const providerSignals = provider
    ? buildProviderTrustSignals({
        marketplaceApproved: provider.verified,
        skills: provider.skills,
        serviceAreas: provider.serviceAreas,
        experience: provider.experience,
        evidenceNote: provider.evidenceNote,
      })
    : []

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Plug A Pro ticket</p>
          <h1 className="mt-1 text-xl font-semibold">Request #{jobRequest.id.slice(-8).toUpperCase()}</h1>
          <p className="text-sm capitalize text-muted-foreground">{jobRequest.category}</p>
        </div>
        {isReviewFirstFlow ? (
          <Badge variant="brand">Review providers</Badge>
        ) : (
          <StatusBadge status={jobRequest.status} type="jobRequest" />
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium">{jobRequest.title}</p>
            <p className="mt-1 text-muted-foreground">{jobRequest.description}</p>
          </div>
          {jobRequest.address && (
            <Row label="Address">
              {jobRequest.address.street}, {normaliseLocationDisplayName(jobRequest.address.suburb)}, {normaliseLocationDisplayName(jobRequest.address.city)}
            </Row>
          )}
          <Row label="Created">
            {jobRequest.createdAt.toLocaleDateString('en-ZA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Row>
          {jobRequest.attachments.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Photos
              </p>
              <div className="grid grid-cols-2 gap-2">
                {jobRequest.attachments.map((photo) => {
                  const src = `/api/attachments/${photo.id}?token=${encodeURIComponent(token)}`
                  return (
                    <AttachmentThumbnail
                      key={photo.id}
                      attachmentId={photo.id}
                      src={src}
                      href={src}
                      alt={photo.caption ?? 'Customer photo'}
                      className="h-36 w-full rounded-lg object-cover"
                      fallbackText="Photo unavailable"
                      showDiagnostics={false}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {((destination.screen === 'request_submitted' && !isReviewFirstFlow) ||
        destination.screen === 'matching_progress' ||
        destination.screen === 'providers_reviewing') && (
        <Card>
          <CardContent className="space-y-3 px-4 py-4 text-sm">
            {destination.screen === 'request_submitted' && (
              <>
                <p className="font-medium">Request submitted</p>
                <p className="text-muted-foreground">
                  We&apos;ve received your {jobRequest.category} request
                  {jobRequest.address ? ` in ${normaliseLocationDisplayName(jobRequest.address.suburb)}, ${normaliseLocationDisplayName(jobRequest.address.city)}` : ''}.
                </p>
                <p className="text-muted-foreground">
                  Choose how you&apos;d like to find a provider.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <form action={chooseMatchingModeFromToken}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="requestId" value={jobRequest.id} />
                    <input type="hidden" name="mode" value="quick_match" />
                    <Button type="submit" className="w-full">
                      Quick Match
                    </Button>
                  </form>
                  <form action={chooseMatchingModeFromToken}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="requestId" value={jobRequest.id} />
                    <input type="hidden" name="mode" value="review_first" />
                    <Button type="submit" variant="outline" className="w-full">
                      Review Providers First
                    </Button>
                  </form>
                </div>
                <p className="text-xs text-muted-foreground">
                  Quick Match asks one suitable provider at a time. Review Providers First lets you compare profiles before sending your request.
                </p>
              </>
            )}
            {destination.screen === 'matching_progress' && (
              <>
                <p className="font-medium">We&apos;re checking suitable providers</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  {['Service type', 'Area', 'Availability', 'Experience', 'Rate', 'Verification level'].map((item) => (
                    <span key={item} className="rounded-md border px-2 py-1">{item}</span>
                  ))}
                </div>
              </>
            )}
            {destination.screen === 'providers_reviewing' && (
              <>
                <p className="font-medium">Providers are reviewing your request</p>
                <p className="text-muted-foreground">
                  Suitable providers are reviewing your request. We&apos;ll notify you when your shortlist is ready.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'provider-confirming' && (
        <Card className="border-[var(--tone-success-border)] bg-[var(--tone-success-bg)]">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-[var(--tone-success-fg)]">
            <p className="font-medium">Provider selected</p>
            <p>
              You selected {selectedShortlistItem?.provider.name ?? 'your provider'}. We are asking them to confirm the job now on WhatsApp.
              You will be notified once accepted.
            </p>
          </CardContent>
        </Card>
      )}

      {destination.screen === 'provider_confirmation' && (
        <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
          <CardContent className="space-y-2 px-4 py-4 text-sm text-[var(--tone-warning-fg)]">
            <p className="font-medium">Waiting for provider confirmation</p>
            <p>
              You selected {selectedShortlistItem?.provider.name ?? 'your provider'}. We notified them on WhatsApp and are asking them to confirm the job now.
              You will be notified once accepted.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={supportHref}>Contact support</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'failed' && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-destructive">
            <p className="font-medium">Selection could not be completed</p>
            <p>Please refresh this link or ask Plug A Pro for help in WhatsApp.</p>
          </CardContent>
        </Card>
      )}

      {(resolvedSearchParams.selection === 'invalid' ||
        resolvedSearchParams.selection === 'more-options-failed' ||
        resolvedSearchParams.selection === 'cancel-failed' ||
        resolvedSearchParams.selection === 'send-shortlist-failed' ||
        resolvedSearchParams.selection === 'matching-mode-failed') && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="space-y-2 px-4 py-4 text-sm text-destructive">
            <p className="font-medium">We could not complete that action</p>
            <p>Please refresh this link, open the latest WhatsApp message, or contact support.</p>
            <Button asChild variant="outline" className="w-full">
              <Link href={supportHref}>Contact support</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'sent-to-shortlist' && (
        <Card className="border-[var(--tone-success-border)] bg-[var(--tone-success-bg)]">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-[var(--tone-success-fg)]">
            <p className="font-medium">Request sent to shortlisted providers</p>
            <p>We notified your selected providers on WhatsApp. We&apos;ll keep updating your request status here.</p>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'shortlisted' && (
        <Card className="border-[var(--tone-success-border)] bg-[var(--tone-success-bg)]">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-[var(--tone-success-fg)]">
            <p className="font-medium">Provider added to your shortlist</p>
            <p>Add up to 3 providers, then send your request to your shortlist.</p>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'shortlist-failed' && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-destructive">
            <p className="font-medium">We could not update your shortlist</p>
            <p>Please refresh this link or ask Plug A Pro for help in WhatsApp.</p>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'more-options' && (
        <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-[var(--tone-warning-fg)]">
            <p className="font-medium">Looking for more options</p>
            <p>We are reaching out to additional providers. We&apos;ll update you here when more responses come in.</p>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'cancelled' && (
        <Card className="border-muted-foreground/30 bg-muted">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-muted-foreground">
            <p className="font-medium">Request cancelled</p>
            <p>Your request has been cancelled. No credits were used and no providers were notified beyond the initial preview.</p>
          </CardContent>
        </Card>
      )}

      {destination.screen === 'expired' && (
        <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
          <CardContent className="space-y-3 px-4 py-4 text-sm text-[var(--tone-warning-fg)]">
            <p className="font-medium">We could not find enough suitable providers yet.</p>
            <p>You can change your preferred time, expand your area, request manual assistance, or start a new request.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="outline">
                <Link href={supportHref}>Ask for help</Link>
              </Button>
              <Button asChild className="w-full">
                <Link href="/services">Start new request</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {destination.screen === 'cancelled' && (
        <Card className="border-muted-foreground/30 bg-muted">
          <CardContent className="space-y-3 px-4 py-4 text-sm">
            <p className="font-medium">Request cancelled</p>
            <p className="text-muted-foreground">You can start a new request anytime.</p>
            <Button asChild className="w-full">
              <Link href="/services">Start new request</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {isReviewFirstFlow && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Review Providers First
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {isReviewFirstSent
                ? 'Your request has been sent to your shortlisted provider. They can open the signed lead link and respond from there.'
                : hasReviewFirstSendFailure
                  ? "We couldn't notify one or more shortlisted providers. Retry sending or choose another provider."
                  : isReviewFirstSending
                    ? "We're sending your request to your selected provider now."
                : 'View matching providers, shortlist 1 to 3, then send your request only to those providers.'}
            </p>
            {isReviewFirstSent ? (
              <p className="text-muted-foreground">
                We&apos;re waiting for your shortlisted provider to respond.
              </p>
            ) : hasReviewFirstSendFailure ? (
              <p className="text-muted-foreground">No response timer is running for failed sends.</p>
            ) : isReviewFirstSending ? (
              <p className="text-muted-foreground">Please wait a moment, then refresh this request.</p>
            ) : isReviewFirstPending ? (
              <p className="text-muted-foreground">We&apos;re finding matching providers for your request.</p>
            ) : reviewCandidates == null ? (
              <p className="text-muted-foreground">We couldn&apos;t load matching providers just now. Please refresh.</p>
            ) : reviewCandidates.candidates.length > 0 ? (
              <div className="space-y-2">
                {reviewCandidates.candidates.map((candidate) => {
                  const alreadyShortlisted = reviewShortlistedProviderIds.has(candidate.providerId)
                  return (
                    <Card key={candidate.providerId} className={alreadyShortlisted ? 'border-primary/50' : undefined}>
                      <CardContent className="space-y-2 px-4 py-3 text-sm">
                        <p className="font-medium">{candidate.name}</p>
                        <p className="text-muted-foreground">
                          {(candidate.skills[0] ?? jobRequest.category)} · {candidate.serviceAreas[0] ?? 'Your area'}
                        </p>
                        {candidate.callOutFee != null && (
                          <p className="text-muted-foreground">Call-out fee: R{Math.round(candidate.callOutFee)}</p>
                        )}
                        {candidate.experience && (
                          <p className="text-muted-foreground">Experience: {candidate.experience}</p>
                        )}
                        <p className="text-muted-foreground">Why matched: {candidate.whyMatched}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {candidate.profileUrl ? (
                            <Button asChild variant="outline" className="w-full">
                              <Link href={candidate.profileUrl}>View profile</Link>
                            </Button>
                          ) : (
                            <Button variant="outline" className="w-full" disabled>
                              Profile unavailable
                            </Button>
                          )}
                          {alreadyShortlisted ? (
                            <Button type="button" className="w-full" disabled>
                              Shortlisted
                            </Button>
                          ) : (
                            <form action={shortlistReviewProviderFromToken}>
                              <input type="hidden" name="token" value={token} />
                              <input type="hidden" name="requestId" value={jobRequest.id} />
                              <input type="hidden" name="providerId" value={candidate.providerId} />
                              <Button type="submit" className="w-full">
                                Shortlist
                              </Button>
                            </form>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            ) : reviewShortlist && reviewShortlist.providers.length > 0 ? (
              <p className="text-muted-foreground">
                All available providers are already in your shortlist. Send your request when you&apos;re ready.
              </p>
            ) : (
              <p className="text-muted-foreground">
                We couldn&apos;t find matching providers in your area right now.
              </p>
            )}
            {reviewShortlist && (
              <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
                <CardContent className="space-y-2 px-4 py-3 text-sm text-[var(--tone-warning-fg)]">
                  <p className="font-medium">Your shortlist</p>
                  {reviewShortlist.providers.length === 0 ? (
                    <p>Please shortlist at least one provider first.</p>
                  ) : (
                    <div className="space-y-1">
                      {reviewShortlist.providers.map((provider, idx) => (
                        <div key={provider.providerId} className="flex items-center justify-between gap-3">
                          <div>
                            <p>{idx + 1}. {provider.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {provider.status === 'SEND_PENDING'
                                ? 'Sending'
                                : provider.status === 'SEND_FAILED'
                                  ? "Couldn't notify provider"
                                  : provider.status === 'SENT'
                                    ? 'Sent'
                                    : provider.status === 'VIEWED'
                                      ? 'Viewed'
                                      : provider.status === 'INTERESTED'
                                        ? 'Responded'
                                        : provider.status === 'DECLINED'
                                          ? 'Declined'
                                          : provider.status === 'EXPIRED'
                                            ? 'Expired'
                                            : 'Not sent yet'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {provider.status === 'SEND_FAILED' && (
                              <Badge variant="destructive">Send failed</Badge>
                            )}
                            {provider.profileUrl && (
                              <Link href={provider.profileUrl} className="text-xs font-medium text-primary underline">
                                View profile
                              </Link>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {reviewCandidates?.hasMore ? (
                      <Button asChild variant="outline" className="w-full">
                        <Link href={`/requests/access/${encodeURIComponent(token)}?view=request_submitted&batch=${reviewBatch + 1}`}>
                          Show 3 more
                        </Link>
                      </Button>
                    ) : (
                      <Button variant="outline" className="w-full" disabled>
                        Show 3 more
                      </Button>
                    )}
                    {isReviewFirstSending ? (
                      <Button type="button" className="w-full" disabled>
                        Sending
                      </Button>
                    ) : isReviewFirstSent && !hasReviewFirstSendFailure ? (
                      <Button type="button" className="w-full" disabled>
                        Sent
                      </Button>
                    ) : (
                      <form action={sendReviewShortlistFromToken}>
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="requestId" value={jobRequest.id} />
                        <Button type="submit" className="w-full" disabled={reviewShortlist.providers.length < 1}>
                          {hasReviewFirstSendFailure ? 'Retry sending' : 'Send request'}
                        </Button>
                      </form>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      {shortlist && shortlist.items.length > 0 && !match && (
        <section className="space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Provider shortlist
            </p>
            <h2 className="mt-1 text-lg font-semibold">We found {shortlist.items.length} suitable provider{shortlist.items.length === 1 ? '' : 's'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare their experience, call-out fee, availability, and profile before choosing.
            </p>
          </div>
          {profileItem && (
            <Card className="border-primary/40">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{profileItem.provider.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {profileItem.provider.verified ? 'Verified provider' : 'Provider-supplied profile'}
                    </p>
                  </div>
                  {profileItem.provider.avatarUrl && (
                    <div
                      aria-label={`${profileItem.provider.name} profile photo`}
                      className="h-14 w-14 rounded-full bg-cover bg-center"
                      role="img"
                      style={{ backgroundImage: `url(${profileItem.provider.avatarUrl})` }}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {profileItem.provider.bio && <p className="text-muted-foreground">{profileItem.provider.bio}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Category" value={jobRequest.category} />
                  <MiniStat label="Experience" value={profileItem.provider.experience || 'On profile'} />
                  <MiniStat label="Call-out fee" value={formatCurrency(profileItem.callOutFee)} />
                  <MiniStat label="Arrival" value={formatDateTime(profileItem.estimatedArrivalAt)} />
                  <MiniStat label="Rate" value={profileItem.rateAmount == null ? (profileItem.negotiable ? 'Negotiable' : 'Not provided') : formatCurrency(profileItem.rateAmount)} />
                  <MiniStat label="Jobs" value={String(profileItem.provider.completedJobsCount)} />
                  <MiniStat label="Rating" value={profileItem.provider.averageRating == null ? 'New' : `${profileItem.provider.averageRating.toFixed(1)} / 5`} />
                </div>
                {profileItem.provider.skills.length > 0 && (
                  <Row label="Skills">{profileItem.provider.skills.slice(0, 5).join(', ')}</Row>
                )}
                {profileItem.provider.serviceAreas.length > 0 && (
                  <Row label="Areas">{profileItem.provider.serviceAreas.slice(0, 5).join(', ')}</Row>
                )}
                {profileItem.provider.portfolioUrls.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Previous work</p>
                    {profileItem.provider.portfolioUrls.slice(0, 4).map((url) => (
                      <a key={url} href={url} className="block break-all text-xs text-primary underline">
                        View previous work
                      </a>
                    ))}
                  </div>
                )}
                <ProviderTrustSignals signals={buildProviderTrustSignals({
                  marketplaceApproved: profileItem.provider.verified,
                  skills: profileItem.provider.skills,
                  experience: profileItem.provider.experience,
                  evidenceNote: profileItem.provider.evidenceNote,
                  completedJobs: profileItem.provider.completedJobsCount,
                  averageRating: profileItem.provider.averageRating,
                })} />
                <ProviderTrustNote marketplaceApproved={profileItem.provider.verified} />
              </CardContent>
            </Card>
          )}
          <div className="space-y-3">
            {shortlist.items.map((item) => {
              const selected = Boolean(item.customerSelectedAt) || jobRequest.selectedLeadInviteId === item.leadInviteId
              const signals = buildProviderTrustSignals({
                marketplaceApproved: item.provider.verified,
                skills: item.provider.skills,
                experience: item.provider.experience,
                evidenceNote: item.provider.evidenceNote,
                completedJobs: item.provider.completedJobsCount,
                averageRating: item.provider.averageRating,
              })
              return (
                <Card key={item.id} className={selected ? 'border-primary' : undefined}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{item.provider.name}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.provider.verified ? 'Application reviewed' : 'Provider-supplied profile'}
                        </p>
                      </div>
                      {item.provider.avatarUrl && (
                        <div
                          aria-label={`${item.provider.name} profile photo`}
                          className="h-12 w-12 rounded-full bg-cover bg-center"
                          role="img"
                          style={{ backgroundImage: `url(${item.provider.avatarUrl})` }}
                        />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {item.provider.bio && <p className="text-muted-foreground">{item.provider.bio}</p>}
                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="Category" value={jobRequest.category} />
                      <MiniStat label="Experience" value={item.provider.experience || 'On profile'} />
                      <MiniStat label="Call-out fee" value={formatCurrency(item.callOutFee)} />
                      <MiniStat label="Arrival" value={formatDateTime(item.estimatedArrivalAt)} />
                      <MiniStat label="Rate" value={item.rateAmount == null ? (item.negotiable ? 'Negotiable' : 'Not provided') : formatCurrency(item.rateAmount)} />
                      <MiniStat label="Jobs" value={String(item.provider.completedJobsCount)} />
                      <MiniStat
                        label="Rating"
                        value={item.provider.averageRating == null ? 'New' : `${item.provider.averageRating.toFixed(1)} / 5`}
                      />
                    </div>
                    {item.provider.portfolioUrls.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Previous work
                        </p>
                        <div className="space-y-1">
                          {item.provider.portfolioUrls.slice(0, 3).map((url) => (
                            <a key={url} href={url} className="block break-all text-xs text-primary underline">
                              View profile work
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    <ProviderTrustSignals signals={signals} />
                    <ProviderTrustNote marketplaceApproved={item.provider.verified} />
                    <Button asChild variant="outline" className="w-full">
                      <Link href={`/requests/access/${encodeURIComponent(token)}?view=shortlist&provider=${encodeURIComponent(item.providerId)}`}>
                        View profile
                      </Link>
                    </Button>
                    {selected ? (
                      <div className="rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                        Selected. We are asking this provider to confirm on WhatsApp.
                      </div>
                    ) : (
                      <form action={selectShortlistProvider}>
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="requestId" value={jobRequest.id} />
                        <input type="hidden" name="shortlistItemId" value={item.id} />
                        <Button type="submit" className="w-full">
                          Select provider
                        </Button>
                      </form>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {(canRequestMoreOptions || canCancelRequest) && (
            <div className="grid grid-cols-2 gap-2">
              {canRequestMoreOptions && (
                <form action={askForMoreShortlistOptions}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="requestId" value={jobRequest.id} />
                  <Button type="submit" variant="outline" className="w-full">
                    Ask for more options
                  </Button>
                </form>
              )}
              {canCancelRequest && (
                <form action={cancelRequestAction}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="requestId" value={jobRequest.id} />
                  <Button type="submit" variant="ghost" className="w-full text-destructive">
                    Cancel request
                  </Button>
                </form>
              )}
            </div>
          )}
        </section>
      )}

      {provider && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Matched provider
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{provider.name}</p>
                {provider.bio && <p className="mt-1 text-muted-foreground">{provider.bio}</p>}
              </div>
              {match && <StatusBadge status={match.status} type="match" />}
            </div>
            <ProviderTrustSignals signals={providerSignals} />
            <ProviderTrustNote marketplaceApproved={provider.verified} />
          </CardContent>
        </Card>
      )}

      {provider && match && (
        <Card className="border-[var(--tone-success-border)] bg-[var(--tone-success-bg)]">
          <CardContent className="space-y-3 px-4 py-4 text-sm text-[var(--tone-success-fg)]">
            <p className="font-medium">Your provider accepted the job</p>
            <Row label="Provider">{provider.name}</Row>
            <Row label="Expected">{formatDateTime(expectedArrivalAt)}</Row>
            <Row label="Call-out">{formatCurrency(selectedShortlistItem?.callOutFee ?? null)}</Row>
            <div className="grid grid-cols-2 gap-2">
              {booking && (
                <Button asChild className="w-full">
                  <Link href={`/bookings/${booking.id}`}>Track job</Link>
                </Button>
              )}
              <Button asChild variant="outline" className="w-full">
                <Link href={`/requests/access/${encodeURIComponent(token)}?view=shortlist&provider=${encodeURIComponent(provider.id)}`}>
                  View provider
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {latestQuote && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Quote history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <QuoteHistoryTimeline
              audience="customer"
              quotes={match?.quotes.map((quote) => ({
                id: quote.id,
                amount: Number(quote.amount),
                labourCost: Number(quote.labourCost),
                materialsCost: Number(quote.materialsCost),
                description: quote.description,
                status: quote.status,
                estimatedHours: quote.estimatedHours,
                preferredDate: quote.preferredDate,
                validUntil: quote.validUntil,
                createdAt: quote.createdAt,
                approvedAt: quote.approvedAt,
                declinedAt: quote.declinedAt,
                notes: quote.notes,
                approvalToken: quote.approvalToken,
              })) ?? []}
            />
          </CardContent>
        </Card>
      )}

      {booking?.job && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Job tracking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 text-sm">
            {trackingSteps.map((step, index) => (
              <div key={step.label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`mt-1 h-4 w-4 rounded-full border-2 ${step.done ? 'border-[var(--tone-success-fg)] bg-[var(--tone-success-fg)]' : step.current ? 'border-foreground bg-foreground' : 'border-muted-foreground/30'}`} />
                  {index < trackingSteps.length - 1 && (
                    <div className={`my-0.5 w-0.5 flex-1 ${step.done ? 'bg-[var(--tone-success-fg)]' : 'bg-border'}`} />
                  )}
                </div>
                <div className={`pb-4 ${step.current ? '' : step.done ? 'opacity-70' : 'opacity-35'}`}>
                  <p className={step.current ? 'font-medium' : undefined}>{step.label}</p>
                  {step.current && <p className="text-xs text-muted-foreground">{step.description}</p>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {booking?.job && currentJobStatus === 'COMPLETED' && (
        <Card>
          <CardContent className="space-y-3 px-4 py-4 text-sm">
            <p className="font-medium">Job completed</p>
            <p className="text-muted-foreground">Please confirm everything is in order.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild className="w-full">
                <Link href={`/bookings/${booking.id}/rate`}>Rate provider</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/book/${encodeURIComponent(jobRequest.category)}`}>Book again</Link>
              </Button>
            </div>
            <Button asChild variant="ghost" className="w-full">
              <Link href={`/bookings/${booking.id}`}>Report issue or view receipt</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {booking?.job && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Work evidence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Job status</p>
              <StatusBadge status={booking.job.status} type="job" />
            </div>
            {booking.job.photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {booking.job.photos.map((photo) => (
                  <div key={photo.id} className="space-y-1">
                    <AttachmentThumbnail
                      attachmentId={photo.id}
                      src={`/api/attachments/${photo.id}?token=${encodeURIComponent(token)}`}
                      href={`/api/attachments/${photo.id}?token=${encodeURIComponent(token)}`}
                      alt={photo.caption ?? 'Work evidence'}
                      className="h-40 w-full rounded-lg object-cover"
                      fallbackText="Photo unavailable"
                      showDiagnostics={false}
                    />
                    {photo.caption && (
                      <p className="text-xs text-muted-foreground">
                        {photo.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                The provider has not uploaded work photos yet.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isReviewFirstFlow && (
        <Card>
          <CardContent className="space-y-3 px-4 py-4 text-sm">
            <p className="font-medium">Need the full account view?</p>
            <p className="text-muted-foreground">
              This secure link only opens this ticket. Sign in if you want your wider request history or account tools.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/sign-in">Sign in to your account</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 flex-shrink-0 text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
