export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { resolveClientPwaDestination } from '@/lib/client-pwa-destination'
import { getCustomerShortlistForRequest } from '@/lib/customer-shortlists'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ProviderTrustNote } from '@/components/shared/provider-trust-note'
import { ProviderTrustSignals } from '@/components/shared/provider-trust-signals'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildProviderTrustSignals } from '@/lib/provider-trust'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import {
  chooseMatchingModeAction,
  sendReviewShortlistAction,
  shortlistReviewProviderAction,
  selectMatchedProviderAction,
  requestMoreShortlistOptionsAction,
  cancelRequestFromShortlistAction,
} from './actions'
import {
  getCustomerReviewShortlist,
  getProviderCandidatesForCustomerReview,
} from '@/lib/review-first'
import { AutoRefresh } from '@/components/customer/AutoRefresh'

export const metadata = buildMetadata({
  title: 'Request Details',
  noIndex: true,
})

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ selection?: string; batch?: string }>
}) {
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const reviewBatch = Math.max(
    1,
    Number.parseInt(resolvedSearchParams.batch ?? '1', 10) || 1,
  )
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    redirect(`/sign-in?next=${encodeURIComponent(`/requests/${id}`)}`)
  }

  const destination = await resolveClientPwaDestination({ requestId: id })
  const jobRequest = destination.request
  if (!jobRequest) notFound()
  const customer = await resolveCustomerForSession(db, session)
  if (!customer || customer.id !== jobRequest.customer.id) {
    redirect('/bookings')
  }
  if (destination.route.startsWith('/bookings/')) {
    redirect(destination.route)
  }

  const match = jobRequest.match
  const latestQuote = match?.quotes[0] ?? null
  const booking = match?.booking ?? null
  const provider = match?.provider ?? null
  const providerSignals = provider
    ? buildProviderTrustSignals({
        marketplaceApproved: provider.verified,
        skills: provider.skills,
        serviceAreas: provider.serviceAreas,
        experience: provider.experience,
        evidenceNote: provider.evidenceNote,
      })
    : []

  // Load the shortlist when the request is awaiting selection or waiting on
  // provider confirmation. No shortlist is shown once a match exists.
  const showShortlist =
    (jobRequest.status === 'SHORTLIST_READY' ||
      jobRequest.status === 'PROVIDER_CONFIRMATION_PENDING') &&
    !match
  const shortlist = showShortlist
    ? await getCustomerShortlistForRequest(jobRequest.id)
    : null
  const selectedShortlistItem =
    shortlist?.items.find(
      (item) =>
        Boolean(item.customerSelectedAt) ||
        jobRequest.selectedLeadInviteId === item.leadInviteId,
    ) ?? null
  const canRequestMoreOptions = jobRequest.status === 'SHORTLIST_READY'
  const canCancelRequest = jobRequest.status === 'SHORTLIST_READY'
  const isReviewFirstFlow =
    jobRequest.status === 'PENDING_VALIDATION' &&
    jobRequest.assignmentMode === 'OPS_REVIEW' &&
    Boolean(jobRequest.latestDispatchDecisionId)
  const isReviewFirstReady = isReviewFirstFlow && Boolean(jobRequest.latestDispatchDecisionId)
  const isReviewFirstPending = isReviewFirstFlow && !isReviewFirstReady
  const reviewCandidates = isReviewFirstReady
    ? await getProviderCandidatesForCustomerReview({
        requestId: jobRequest.id,
        customerId: customer.id,
        batch: reviewBatch,
      }).catch(() => null)
    : null
  const reviewShortlist = isReviewFirstReady
    ? await getCustomerReviewShortlist({
        requestId: jobRequest.id,
        customerId: customer.id,
      }).catch(() => null)
    : null

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <AutoRefresh
        terminalState={(
          ['CANCELLED', 'COMPLETED', 'EXPIRED', 'CLOSED'] as string[]
        ).includes(jobRequest.status)}
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/bookings"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← My requests & bookings
          </Link>
          <h1 className="text-xl font-semibold mt-1">
            Request #{jobRequest.id.slice(-8).toUpperCase()}
          </h1>
          <p className="text-sm text-muted-foreground capitalize">
            {jobRequest.category}
          </p>
        </div>
        <StatusBadge status={jobRequest.status} type="jobRequest" />
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
            <p className="text-muted-foreground mt-1">
              {jobRequest.description}
            </p>
          </div>
          {jobRequest.address && (
            <Row label="Address">
              {jobRequest.address.street}, {jobRequest.address.suburb},{' '}
              {jobRequest.address.city}
            </Row>
          )}
          <Row label="Created">
            {jobRequest.createdAt.toLocaleDateString('en-ZA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Row>
          {jobRequest.expiresAt && (
            <Row label="Match window">
              Until{' '}
              {jobRequest.expiresAt.toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Row>
          )}
          {jobRequest.attachments.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Photos
              </p>
              <div className="grid grid-cols-2 gap-2">
                {jobRequest.attachments.map((photo) => (
                  <a
                    key={photo.id}
                    href={`/api/attachments/${photo.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/attachments/${photo.id}`}
                      alt={photo.caption ?? photo.label ?? 'Job photo'}
                      className="h-36 w-full rounded-lg object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancelled state banner */}
      {jobRequest.status === 'CANCELLED' && (
        <Card className="border-muted-foreground/30 bg-muted">
          <CardContent className="space-y-3 px-4 py-4 text-sm">
            <p className="font-medium">Request cancelled</p>
            <p className="text-muted-foreground">
              You can start a new request anytime.
            </p>
            <Button asChild className="w-full">
              <Link href="/services">Start new request</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Expired state banner — no suitable providers found within the match window */}
      {jobRequest.status === 'EXPIRED' && (
        <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
          <CardContent className="space-y-3 px-4 py-4 text-sm text-[var(--tone-warning-fg)]">
            <p className="font-medium">
              We could not find enough suitable providers yet.
            </p>
            <p>
              You can change your preferred time, expand your area, request
              manual assistance, or start a new request.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="outline" className="w-full">
                <Link href="https://plugapro.co.za/contact">Ask for help</Link>
              </Button>
              <Button asChild className="w-full">
                <Link href="/services">Start new request</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider confirmation banner — shown when a provider has been selected
          and their confirmation is pending. */}
      {jobRequest.status === 'PROVIDER_CONFIRMATION_PENDING' &&
        selectedShortlistItem && (
          <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
            <CardContent className="space-y-2 px-4 py-4 text-sm text-[var(--tone-warning-fg)]">
              <p className="font-medium">Waiting for provider confirmation</p>
              <p>
                You selected {selectedShortlistItem.provider.name}. We notified
                them on WhatsApp and are asking them to confirm the job. You
                will be notified once they accept.
              </p>
            </CardContent>
          </Card>
        )}

      {/* Provider declined banner — shown when the selected provider could not confirm */}
      {resolvedSearchParams.selection === 'provider-declined' && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="space-y-2 px-4 py-4 text-sm text-destructive">
            <p className="font-medium">
              The selected provider could not confirm this job.
            </p>
            <p>
              You can choose another provider from your shortlist below. If you
              need help, please contact us.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="https://plugapro.co.za/contact">Contact support</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Matching timed out — still in matching after extended wait */}
      {jobRequest.status === 'MATCHING' &&
        resolvedSearchParams.selection === 'matching-timeout' && (
          <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
            <CardContent className="space-y-2 px-4 py-4 text-sm text-[var(--tone-warning-fg)]">
              <p className="font-medium">
                We&apos;re still waiting for provider responses.
              </p>
              <p>
                You can keep waiting, adjust your request, or ask us for help.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="https://plugapro.co.za/contact">Ask for help</Link>
              </Button>
            </CardContent>
          </Card>
        )}

      {/* Shortlist — shown when SHORTLIST_READY or PROVIDER_CONFIRMATION_PENDING with no final match */}
      {shortlist && shortlist.items.length > 0 && !match && (
        <section className="space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Provider shortlist
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              We found {shortlist.items.length} suitable provider
              {shortlist.items.length === 1 ? '' : 's'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare their experience, call-out fee, availability, and profile
              before choosing.
            </p>
          </div>
          <div className="space-y-3">
            {shortlist.items.map((item) => {
              const selected =
                Boolean(item.customerSelectedAt) ||
                jobRequest.selectedLeadInviteId === item.leadInviteId
              const signals = buildProviderTrustSignals({
                marketplaceApproved: item.provider.verified,
                skills: item.provider.skills,
                experience: item.provider.experience,
                evidenceNote: item.provider.evidenceNote,
                completedJobs: item.provider.completedJobsCount,
                averageRating: item.provider.averageRating,
              })
              return (
                <Card
                  key={item.id}
                  className={selected ? 'border-primary' : undefined}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">
                          {item.provider.name}
                        </CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.provider.verified
                            ? 'Application reviewed'
                            : 'Provider-supplied profile'}
                        </p>
                      </div>
                      {item.provider.avatarUrl && (
                        <div
                          aria-label={`${item.provider.name} profile photo`}
                          className="h-12 w-12 rounded-full bg-cover bg-center"
                          role="img"
                          style={{
                            backgroundImage: `url(${item.provider.avatarUrl})`,
                          }}
                        />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {item.provider.bio && (
                      <p className="text-muted-foreground">
                        {item.provider.bio}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="Category" value={jobRequest.category} />
                      <MiniStat
                        label="Experience"
                        value={item.provider.experience || 'On profile'}
                      />
                      <MiniStat
                        label="Call-out fee"
                        value={formatCurrency(item.callOutFee)}
                      />
                      <MiniStat
                        label="Arrival"
                        value={formatDateTime(item.estimatedArrivalAt)}
                      />
                      <MiniStat
                        label="Rate"
                        value={
                          item.rateAmount == null
                            ? item.negotiable
                              ? 'Negotiable'
                              : 'Not provided'
                            : formatCurrency(item.rateAmount)
                        }
                      />
                      <MiniStat
                        label="Jobs"
                        value={String(item.provider.completedJobsCount)}
                      />
                      <MiniStat
                        label="Rating"
                        value={
                          item.provider.averageRating == null
                            ? 'New'
                            : `${item.provider.averageRating.toFixed(1)} / 5`
                        }
                      />
                    </div>
                    {item.provider.skills.length > 0 && (
                      <Row label="Skills">
                        {item.provider.skills.slice(0, 5).join(', ')}
                      </Row>
                    )}
                    {item.provider.portfolioUrls.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Previous work
                        </p>
                        {item.provider.portfolioUrls.slice(0, 3).map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block break-all text-xs text-primary underline"
                          >
                            View previous work
                          </a>
                        ))}
                      </div>
                    )}
                    <ProviderTrustSignals signals={signals} />
                    <ProviderTrustNote
                      marketplaceApproved={item.provider.verified}
                    />
                    <Button asChild variant="outline" className="w-full">
                      <Link href={`/providers/${item.providerId}`}>
                        View profile
                      </Link>
                    </Button>
                    {selected ? (
                      <div className="rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                        Selected. We are asking this provider to confirm on
                        WhatsApp.
                      </div>
                    ) : (
                      jobRequest.status === 'SHORTLIST_READY' && (
                        <form
                          action={async (formData) => {
                            'use server'
                            await selectMatchedProviderAction(
                              jobRequest.id,
                              item.providerId,
                              formData,
                            )
                          }}
                        >
                          <Button type="submit" className="w-full">
                            Select provider
                          </Button>
                        </form>
                      )
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {(canRequestMoreOptions || canCancelRequest) && (
            <div className="grid grid-cols-2 gap-2">
              {canRequestMoreOptions && (
                <form
                  action={async (formData) => {
                    'use server'
                    await requestMoreShortlistOptionsAction(
                      jobRequest.id,
                      formData,
                    )
                  }}
                >
                  <Button type="submit" variant="outline" className="w-full">
                    Ask for more options
                  </Button>
                </form>
              )}
              {canCancelRequest && (
                <form
                  action={async (formData) => {
                    'use server'
                    await cancelRequestFromShortlistAction(
                      jobRequest.id,
                      formData,
                    )
                  }}
                >
                  <Button
                    type="submit"
                    variant="ghost"
                    className="w-full text-destructive"
                  >
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
                {provider.bio && (
                  <p className="text-muted-foreground mt-1">{provider.bio}</p>
                )}
              </div>
              {match && <StatusBadge status={match.status} type="match" />}
            </div>
            <ProviderTrustSignals signals={providerSignals} />
            {provider.portfolioUrls.length > 0 && (
              <div className="rounded-lg border px-3 py-3">
                <p className="text-sm font-medium">Portfolio links</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Shared by the provider unless Plug A Pro says a specific link
                  or document was reviewed.
                </p>
                <div className="mt-2 space-y-1.5">
                  {provider.portfolioUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block break-all text-sm text-primary hover:underline"
                    >
                      {url}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <ProviderTrustNote marketplaceApproved={provider.verified} />
            <Button asChild variant="outline" className="w-full">
              <Link href={`/providers/${provider.id}`}>
                View provider profile
              </Link>
            </Button>
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
              requestId={id}
              quotes={
                match?.quotes.map((quote) => ({
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
                })) ?? []
              }
            />
          </CardContent>
        </Card>
      )}

      {booking ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Booking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {booking.scheduledDate
                    ? booking.scheduledDate.toLocaleDateString('en-ZA', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })
                    : 'Date to be confirmed'}
                </p>
                {booking.scheduledWindow && (
                  <p className="text-muted-foreground">
                    {booking.scheduledWindow}
                  </p>
                )}
              </div>
              {booking.job ? (
                <StatusBadge status={booking.job.status} type="job" />
              ) : (
                <StatusBadge status={booking.status} type="booking" />
              )}
            </div>
            <Button asChild className="w-full">
              <Link href={`/bookings/${booking.id}`}>Open booking details</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Matching activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {jobRequest.status === 'PENDING_VALIDATION' && (
              <div className="space-y-1">
                {!isReviewFirstFlow ? (
                  <>
                    <p className="font-medium">
                      Choose how to find your provider
                    </p>
                    <p className="text-muted-foreground">
                      We&apos;ve received your {jobRequest.category} request
                      {jobRequest.address
                        ? ` in ${normaliseLocationDisplayName(jobRequest.address.suburb)}, ${normaliseLocationDisplayName(jobRequest.address.city)}`
                        : ''}
                      .
                    </p>
                    <p className="text-muted-foreground">
                      Select Quick Match to contact one suitable provider at a
                      time, or Review Providers First to compare options before
                      choosing.
                    </p>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <form
                        action={async (formData) => {
                          'use server'
                          await chooseMatchingModeAction(
                            jobRequest.id,
                            'quick_match',
                            formData,
                          )
                        }}
                      >
                        <Button type="submit" className="w-full">
                          Quick Match
                        </Button>
                      </form>
                      <form
                        action={async (formData) => {
                          'use server'
                          await chooseMatchingModeAction(
                            jobRequest.id,
                            'review_first',
                            formData,
                          )
                        }}
                      >
                        <Button
                          type="submit"
                          variant="outline"
                          className="w-full"
                        >
                          Review Providers First
                        </Button>
                      </form>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3 pt-1">
                    <p className="font-medium">Review Providers First</p>
                    <p className="text-muted-foreground">
                      Shortlist 1 to 3 providers, then send your request only to
                      those providers.
                    </p>
                    {isReviewFirstPending ? (
                      <p className="text-muted-foreground">We&apos;re finding matching providers for your request.</p>
                    ) : reviewCandidates?.candidates?.length ? (
                      <div className="space-y-2">
                        {reviewCandidates.candidates.map((candidate) => (
                          <Card key={candidate.providerId}>
                            <CardContent className="space-y-2 px-4 py-3 text-sm">
                              <p className="font-medium">{candidate.name}</p>
                              <p className="text-muted-foreground">
                                {candidate.skills[0] ?? jobRequest.category} ·{' '}
                                {candidate.serviceAreas[0] ?? 'Your area'}
                              </p>
                              {candidate.callOutFee != null && (
                                <p className="text-muted-foreground">
                                  Call-out fee: R
                                  {Math.round(candidate.callOutFee)}
                                </p>
                              )}
                              {candidate.experience && (
                                <p className="text-muted-foreground">
                                  Experience: {candidate.experience}
                                </p>
                              )}
                              <p className="text-muted-foreground">
                                Why matched: {candidate.whyMatched}
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                {candidate.profileUrl ? (
                                  <Button
                                    asChild
                                    variant="outline"
                                    className="w-full"
                                  >
                                    <Link href={candidate.profileUrl}>
                                      View profile
                                    </Link>
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    className="w-full"
                                    disabled
                                  >
                                    View profile
                                  </Button>
                                )}
                                <form
                                  action={async (formData) => {
                                    'use server'
                                    await shortlistReviewProviderAction(
                                      jobRequest.id,
                                      candidate.providerId,
                                      formData,
                                    )
                                  }}
                                >
                                  <Button type="submit" className="w-full">
                                    Shortlist
                                  </Button>
                                </form>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        No matching providers are available right now.
                      </p>
                    )}
                    {reviewShortlist && (
                      <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
                        <CardContent className="space-y-2 px-4 py-3 text-sm">
                          <p className="font-medium text-[var(--tone-warning-fg)]">
                            Your shortlist
                          </p>
                          {reviewShortlist.providers.length === 0 ? (
                            <p className="text-[var(--tone-warning-fg)]">
                              Please shortlist at least one provider first.
                            </p>
                          ) : (
                            <div className="space-y-1 text-[var(--tone-warning-fg)]">
                              {reviewShortlist.providers.map(
                                (provider, idx) => (
                                  <p key={provider.providerId}>
                                    {idx + 1}. {provider.name}
                                  </p>
                                ),
                              )}
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <Button
                              asChild
                              variant="outline"
                              className="w-full"
                            >
                              <Link
                                href={`/requests/${jobRequest.id}?batch=${reviewBatch + 1}`}
                              >
                                Show 3 more
                              </Link>
                            </Button>
                            <form
                              action={async (formData) => {
                                'use server'
                                await sendReviewShortlistAction(
                                  jobRequest.id,
                                  formData,
                                )
                              }}
                            >
                              <Button
                                type="submit"
                                className="w-full"
                                disabled={reviewShortlist.providers.length < 1}
                              >
                                Send request
                              </Button>
                            </form>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            )}
            {jobRequest.status === 'OPEN' && (
              <div className="space-y-2">
                <p className="font-medium">We match based on:</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  {[
                    'Service type',
                    'Area',
                    'Availability',
                    'Experience',
                    'Rate',
                    'Verification level',
                  ].map((item) => (
                    <span key={item} className="rounded-md border px-2 py-1">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {jobRequest.status === 'MATCHING' && (
              <div className="space-y-1">
                <p className="font-medium">
                  Providers are reviewing your request
                </p>
                <p className="text-muted-foreground">
                  {jobRequest.assignmentMode === 'OPS_REVIEW'
                    ? "Your shortlisted providers are reviewing your request. We'll notify you as each response comes in."
                    : "Suitable providers are reviewing your request. We'll notify you when your shortlist is ready."}
                </p>
              </div>
            )}
            {(jobRequest.status === 'OPEN' ||
              jobRequest.status === 'MATCHING') && (
              <div className="rounded-lg bg-muted/50 border px-4 py-3 text-sm text-foreground">
                {getMatchEtaCopy()}
              </div>
            )}
            {jobRequest.status === 'PENDING_VALIDATION' ? (
              <p className="text-muted-foreground">
                Matching starts after you choose a mode above.
              </p>
            ) : jobRequest.leads.length === 0 ? (
              <p className="text-muted-foreground">
                We&apos;re still validating the request before it is sent to
                providers.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  {jobRequest.leads.length} provider
                  {jobRequest.leads.length === 1 ? '' : 's'} notified so far.
                </p>
                <div className="space-y-2">
                  {jobRequest.leads.map((lead) => (
                    <div key={lead.id} className="rounded-lg border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{lead.provider.name}</p>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          {lead.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Sent{' '}
                        {lead.sentAt.toLocaleDateString('en-ZA', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function getMatchEtaCopy(): string {
  const hour = new Date().getHours()
  if (hour >= 8 && hour < 18)
    return "We're checking one suitable provider at a time — first response is typically within 5–10 minutes."
  if (hour >= 18 && hour < 22)
    return "We're looking for a provider — typically within 30–60 minutes during off-peak hours."
  return "We'll pick this up first thing in the morning and match you quickly."
}

function formatCurrency(amount: number | null) {
  if (amount == null) return 'Not provided'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amount)
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

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
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
