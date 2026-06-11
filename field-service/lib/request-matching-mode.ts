import { db } from './db'
import { orchestrateMatch } from './matching/orchestrator'
import { getJobRequestAccessUrl } from './job-request-access'
import { sendButtons, sendCtaUrl, sendText } from './whatsapp-interactive'
import { matchEligibleProvidersForServiceRequest } from './review-first'
import { ctaLabelFor } from './whatsapp-copy'

export type CustomerMatchingMode = 'quick_match' | 'review_first'

export class RequestMatchingModeError extends Error {
  constructor(
    public readonly code:
      | 'REQUEST_NOT_FOUND'
      | 'FORBIDDEN'
      | 'REQUEST_NOT_EDITABLE'
      | 'INVALID_MODE',
    message: string,
  ) {
    super(message)
    this.name = 'RequestMatchingModeError'
  }
}

const SENT_OR_BETTER = ['SENT', 'DELIVERED', 'READ'] as const

async function hasSentCustomerOutcome(params: {
  to: string
  requestId: string
  templateName: string
}) {
  try {
    const existing = await db.messageEvent.findFirst({
      where: {
        to: params.to,
        templateName: params.templateName,
        status: { in: [...SENT_OR_BETTER] },
        metadata: {
          path: ['requestId'],
          equals: params.requestId,
        },
      },
      select: { id: true },
    })
    return Boolean(existing)
  } catch (error) {
    console.warn('[request-matching-mode] customer outcome idempotency lookup failed', {
      requestId: params.requestId,
      templateName: params.templateName,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function sendReviewFirstOutcome(params: {
  requestId: string
  phone: string
  status: 'review_options_ready' | 'review_no_candidates' | 'review_matching_failed'
  candidateCount: number
}) {
  const templateName =
    params.status === 'review_options_ready'
      ? 'interactive:client_review_first_ready_cta'
      : params.status === 'review_no_candidates'
        ? 'interactive:client_review_first_no_candidates'
        : 'interactive:client_review_first_failed'

  if (await hasSentCustomerOutcome({ to: params.phone, requestId: params.requestId, templateName })) {
    console.info('[request-matching-mode] customer review-first outcome skipped_duplicate', {
      requestId: params.requestId,
      outcome: params.status,
      candidateCount: params.candidateCount,
    })
    return
  }

  if (params.status === 'review_options_ready') {
    const text = `Review Providers First is ready.\n\nWe found ${params.candidateCount} matching provider${params.candidateCount === 1 ? '' : 's'} for your request.\n\nOpen your request to view their profiles and rank up to 3 providers in your preferred order. We'll contact your 1st choice first - if they can't make it, we'll automatically try your 2nd and 3rd.`
    const url = await getJobRequestAccessUrl(params.requestId, 'matching_status').catch((error) => {
      console.warn('[request-matching-mode] review-first CTA URL generation failed', {
        requestId: params.requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })

    if (url?.startsWith('https://')) {
      await sendCtaUrl(params.phone, text, ctaLabelFor('view_request'), url, undefined, {
        templateName,
        metadata: {
          requestId: params.requestId,
          reviewCandidateCount: params.candidateCount,
          idempotencyKey: `${templateName}:${params.requestId}`,
        },
      })
      console.info('[request-matching-mode] customer review-first ready CTA sent', {
        requestId: params.requestId,
        candidateCount: params.candidateCount,
      })
      return
    }

    await sendButtons(
      params.phone,
      `${text}\n\nIf the app link is unavailable, refresh your request status.`,
      [
        { id: `status_refresh_${params.requestId}`, title: ctaLabelFor('check_status') },
        { id: 'status', title: 'My Requests' },
        { id: 'back_home', title: 'Main menu' },
      ],
      undefined,
      {
        templateName,
        metadata: {
          requestId: params.requestId,
          reviewCandidateCount: params.candidateCount,
          idempotencyKey: `${templateName}:${params.requestId}`,
        },
      },
    )
    return
  }

  if (params.status === 'review_no_candidates') {
    await sendButtons(
      params.phone,
      "We couldn't find matching providers in your area right now.\n\nYou can try Quick Match, edit your request or return to the main menu.",
      [
        { id: `status_mode_quick_${params.requestId}`, title: 'Quick Match' },
        { id: `status_refresh_${params.requestId}`, title: 'Check status' },
        { id: 'back_home', title: 'Main menu' },
      ],
      undefined,
      {
        templateName,
        metadata: {
          requestId: params.requestId,
          reviewCandidateCount: params.candidateCount,
          idempotencyKey: `${templateName}:${params.requestId}`,
        },
      },
    )
    return
  }

  await sendButtons(
    params.phone,
    'Review Providers First could not be prepared right now.\n\nYour request is saved. Please try again.',
    [
      { id: `status_mode_review_${params.requestId}`, title: 'Try again' },
      { id: `status_mode_quick_${params.requestId}`, title: 'Quick Match' },
      { id: 'back_home', title: 'Main menu' },
    ],
    undefined,
    {
      templateName,
      metadata: {
        requestId: params.requestId,
        reviewCandidateCount: params.candidateCount,
        idempotencyKey: `${templateName}:${params.requestId}`,
      },
    },
  )
}

export async function selectCustomerRequestMatchingMode(params: {
  requestId: string
  customerId: string
  mode: CustomerMatchingMode
}) {
  if (params.mode !== 'quick_match' && params.mode !== 'review_first') {
    throw new RequestMatchingModeError('INVALID_MODE', 'Unsupported matching mode.')
  }

  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      customerId: true,
      status: true,
      assignmentMode: true,
      category: true,
      source: true,
      customer: { select: { phone: true } },
    },
  })

  if (!request) {
    throw new RequestMatchingModeError('REQUEST_NOT_FOUND', 'Request not found.')
  }
  if (request.customerId !== params.customerId) {
    throw new RequestMatchingModeError('FORBIDDEN', 'Request does not belong to this customer.')
  }

  if (['MATCHED', 'CANCELLED', 'EXPIRED'].includes(request.status)) {
    throw new RequestMatchingModeError('REQUEST_NOT_EDITABLE', 'Request is no longer editable.')
  }

  // Ops-validation guard (finding 5dd66cbd): JobRequest.status === PENDING_VALIDATION
  // is overloaded to mean both (a) the customer-deferred "waiting for matching-mode
  // selection" state and (b) the ops-review validation queue. A customer must only
  // be able to self-approve the FORMER. Requests created via the customer's own
  // self-service deferred-consent flow carry a recognised customer-channel source
  // (pwa / whatsapp); anything placed in PENDING_VALIDATION without such a source
  // (e.g. an ops/admin/system hold for genuine review) must stay in the admin
  // queue and cannot be customer-approved into OPEN here.
  const CUSTOMER_SELF_SERVICE_SOURCES = new Set(['pwa', 'whatsapp'])
  const isCustomerDeferredRequest = CUSTOMER_SELF_SERVICE_SOURCES.has(
    (request.source ?? '').trim().toLowerCase(),
  )
  if (request.status === 'PENDING_VALIDATION' && !isCustomerDeferredRequest) {
    console.info('[matching-mode] rejected - pending_validation not customer-deferred', {
      requestId: request.id,
      source: request.source ?? null,
      mode: params.mode,
    })
    throw new RequestMatchingModeError(
      'REQUEST_NOT_EDITABLE',
      'This request is under review and cannot be changed right now.',
    )
  }

  const targetAssignmentMode = params.mode === 'quick_match' ? 'AUTO_ASSIGN' : 'OPS_REVIEW'

  const activeHold = await db.assignmentHold.findFirst({
    where: { jobRequestId: request.id, status: 'ACTIVE' },
    select: { id: true },
  })

  if (activeHold) {
    if (request.assignmentMode === targetAssignmentMode) {
      console.info('[matching-mode] noop - already in progress', { requestId: request.id, mode: params.mode })
      return { requestId: request.id, mode: params.mode, status: 'already_in_progress' as const }
    }
    console.info('[matching-mode] rejected - hold active', { requestId: request.id, mode: params.mode })
    throw new RequestMatchingModeError(
      'REQUEST_NOT_EDITABLE',
      'Cannot change matching mode while a provider outreach is active.',
    )
  }
  let nextStatus = request.status
  let quickMatchResult: Awaited<ReturnType<typeof orchestrateMatch>> | null = null
  let reviewCandidateCount = 0
  let reviewFailed = false

  if (params.mode === 'review_first') {
    if (request.status === 'PENDING_VALIDATION' || request.status === 'OPEN') {
      await db.jobRequest.update({
        where: { id: request.id },
        data: {
          status: 'PENDING_VALIDATION',
          assignmentMode: 'OPS_REVIEW',
        },
      })
      nextStatus = 'PENDING_VALIDATION'
    }
  } else if (request.status === 'PENDING_VALIDATION') {
    await db.jobRequest.update({
      where: { id: request.id },
      data: {
        status: 'OPEN',
        assignmentMode: targetAssignmentMode,
      },
    })
    nextStatus = 'OPEN'
  } else if (request.status === 'OPEN') {
    await db.jobRequest.update({
      where: { id: request.id },
      data: { assignmentMode: targetAssignmentMode },
    })
    nextStatus = 'OPEN'
  }

  if (params.mode === 'review_first') {
    try {
      const matchResult = await matchEligibleProvidersForServiceRequest({
        serviceRequestId: request.id,
      })

      reviewCandidateCount = matchResult.providers.length
      console.info('[request-matching-mode] review-first candidates generated', {
        requestId: request.id,
        candidateCount: reviewCandidateCount,
        matchStatus: matchResult.status,
        wasCached: matchResult.wasCached,
      })
    } catch (error) {
      reviewFailed = true
      console.error('[request-matching-mode] review-first candidate generation failed', {
        requestId: request.id,
        customerId: params.customerId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } else if (nextStatus === 'OPEN') {
    quickMatchResult = await orchestrateMatch(request.id, { triggeredBy: 'manual' }).catch((error) => {
      console.error('[request-matching-mode] matching trigger failed', {
        requestId: request.id,
        mode: params.mode,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })
  }

  if (request.customer?.phone) {
    let text = ''
    if (params.mode === 'quick_match') {
      const finalNoMatch =
        quickMatchResult?.status === 'NO_MATCH' &&
        (quickMatchResult.failureClass === 'EMPTY_POOL' || quickMatchResult.failureClass === 'STRUCTURAL')
          ? quickMatchResult
          : null

      if (!finalNoMatch) {
        text =
          quickMatchResult?.status === 'NO_MATCH'
          ? `Quick Match started.\n\nNo providers in your area are available right now.\n\nWe'll keep trying and notify you the moment one becomes available.`
          : `Quick Match started.\n\nWe're checking with one suitable provider now.\nIf they don't respond, we'll try the next provider.`
      } else {
        console.info('[request-matching-mode] quick_match final no-match notification handled by expiry', {
          requestId: request.id,
          failureClass: finalNoMatch.failureClass,
          primaryReason: finalNoMatch.primaryReason,
        })
      }
    }

    if (params.mode === 'review_first') {
      const outcome = reviewFailed
        ? 'review_matching_failed'
        : reviewCandidateCount > 0
          ? 'review_options_ready'
          : 'review_no_candidates'

      await sendReviewFirstOutcome({
        requestId: request.id,
        phone: request.customer.phone,
        status: outcome,
        candidateCount: reviewCandidateCount,
      }).catch((error) => {
        console.warn('[request-matching-mode] customer review-first notification failed', {
          requestId: request.id,
          mode: params.mode,
          reviewCandidateCount,
          outcome,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    } else {
      if (text) {
        await sendText(
          request.customer.phone,
          text,
          {
            templateName: 'interactive:client_matching_mode_selected',
            metadata: {
              requestId: request.id,
              mode: params.mode,
              reviewCandidateCount,
            },
          },
        ).catch((error) => {
          console.warn('[request-matching-mode] customer matching mode notification failed', {
            requestId: request.id,
            mode: params.mode,
            reviewCandidateCount,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    }
  }

  return {
    requestId: request.id,
    mode: params.mode,
    status:
      params.mode === 'review_first'
        ? reviewFailed
          ? 'review_matching_failed'
          : reviewCandidateCount > 0
            ? 'review_options_ready'
            : 'review_no_candidates'
        : nextStatus === 'OPEN'
          ? 'matching_started'
          : 'already_in_progress',
  } as const
}
