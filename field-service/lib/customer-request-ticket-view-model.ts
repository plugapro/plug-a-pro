import { resolveClientPwaDestination, type ClientPwaDestination } from './client-pwa-destination'
import { getCustomerShortlistForRequest } from './customer-shortlists'
import {
  getCustomerReviewShortlist,
  getProviderCandidatesForCustomerReview,
} from './review-first'
import { createTraceId } from './support-diagnostics'

type ShortlistShape = Awaited<ReturnType<typeof getCustomerShortlistForRequest>>
type ReviewCandidatesShape = Awaited<ReturnType<typeof getProviderCandidatesForCustomerReview>> | null
type ReviewShortlistShape = Awaited<ReturnType<typeof getCustomerReviewShortlist>> | null

export type CustomerRequestTicketViewModel =
  | {
      kind: 'ready'
      traceId: string
      token: string
      destination: ClientPwaDestination
      shortlist: ShortlistShape
      reviewCandidates: ReviewCandidatesShape
      reviewShortlist: ReviewShortlistShape
    }
  | {
      kind: 'unavailable'
      traceId: string
      token: string
      reason: 'expired' | 'invalid' | 'resolve_failed'
      destination: ClientPwaDestination | null
    }

/**
 * Resolve a WhatsApp request-status token into a crash-safe ticket model.
 * Any resolver/query failure must degrade to a controlled unavailable state.
 */
export async function buildCustomerRequestTicketViewModel(params: {
  token: string
  intendedScreen?: string | null
  reviewBatch?: number
}): Promise<CustomerRequestTicketViewModel> {
  const traceId = createTraceId('tkt')
  const token = params.token

  let destination: ClientPwaDestination | null = null
  try {
    destination = await resolveClientPwaDestination({
      token,
      intendedScreen: params.intendedScreen ?? null,
    })
  } catch (error) {
    // Resolver failures (schema drift, stale enum values, relation decode errors)
    // should not crash the whole PWA shell for old WhatsApp links.
    console.error('[ticket-access] destination resolve failed', {
      traceId,
      route: '/requests/access/[token]',
      tokenStatus: 'resolve_failed',
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      kind: 'unavailable',
      traceId,
      token,
      reason: 'resolve_failed',
      destination: null,
    }
  }

  if (destination.accessLevel !== 'public_token' || !destination.request) {
    const reason = destination.accessLevel === 'expired' ? 'expired' : 'invalid'
    console.info('[ticket-access] token unavailable state', {
      traceId,
      route: '/requests/access/[token]',
      tokenStatus: destination.accessLevel,
      destinationScreen: destination.screen,
      destinationReason: destination.reason,
      requestId: destination.request?.id ?? null,
      requestStatus: destination.request?.status ?? null,
    })
    return {
      kind: 'unavailable',
      traceId,
      token,
      reason,
      destination,
    }
  }

  const batch = Math.max(1, params.reviewBatch ?? 1)
  const isReviewFirstFlow =
    (destination.request.status === 'PENDING_VALIDATION' || destination.request.status === 'MATCHING') &&
    destination.request.assignmentMode === 'OPS_REVIEW' &&
    Boolean(destination.request.latestDispatchDecisionId)

  const customerId = destination.request.customer?.id

  const shortlistPromise = getCustomerShortlistForRequest(destination.request.id).catch((error) => {
    // Shortlist is optional for most request states; suppress fetch failures and
    // continue rendering the ticket status page.
    console.warn('[ticket-access] shortlist fetch failed (non-fatal)', {
      traceId,
      route: '/requests/access/[token]',
      requestId: destination.request!.id,
      requestStatus: destination.request!.status,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  })

  const reviewCandidatesPromise: Promise<ReviewCandidatesShape> = isReviewFirstFlow && customerId
    ? getProviderCandidatesForCustomerReview({
        requestId: destination.request.id,
        customerId,
        batch,
      }).catch((error) => {
        // Candidate rendering should fail closed to a clear empty-state in the
        // ticket page, not crash the whole public-token flow.
        console.warn('[ticket-access] review candidates fetch failed (non-fatal)', {
          traceId,
          route: '/requests/access/[token]',
          requestId: destination.request!.id,
          requestStatus: destination.request!.status,
          assignmentMode: destination.request!.assignmentMode,
          batch,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      })
    : Promise.resolve(null)

  const reviewShortlistPromise: Promise<ReviewShortlistShape> = isReviewFirstFlow && customerId
    ? getCustomerReviewShortlist({
        requestId: destination.request.id,
        customerId,
      }).catch((error) => {
        // Shortlist read errors are non-fatal for the same reason as shortlist
        // fetch above; we still render the request details safely.
        console.warn('[ticket-access] review shortlist fetch failed (non-fatal)', {
          traceId,
          route: '/requests/access/[token]',
          requestId: destination.request!.id,
          requestStatus: destination.request!.status,
          assignmentMode: destination.request!.assignmentMode,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      })
    : Promise.resolve(null)

  const [shortlist, reviewCandidates, reviewShortlist] = await Promise.all([
    shortlistPromise,
    reviewCandidatesPromise,
    reviewShortlistPromise,
  ])

  console.info('[ticket-access] ticket view model ready', {
    traceId,
    route: '/requests/access/[token]',
    requestId: destination.request.id,
    requestStatus: destination.request.status,
    matchingMode: destination.request.assignmentMode,
    destinationScreen: destination.screen,
    destinationReason: destination.reason,
    shortlistItems: shortlist?.items.length ?? 0,
    reviewCandidateCount: reviewCandidates?.candidates.length ?? 0,
    reviewShortlistCount: reviewShortlist?.providers.length ?? 0,
  })

  return {
    kind: 'ready',
    traceId,
    token,
    destination,
    shortlist,
    reviewCandidates,
    reviewShortlist,
  }
}
