import { db } from './db'
import { orchestrateMatch } from './matching/orchestrator'
import { sendText } from './whatsapp-interactive'
import { getProviderCandidatesForCustomerReview } from './review-first'

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

  const targetAssignmentMode = params.mode === 'quick_match' ? 'AUTO_ASSIGN' : 'OPS_REVIEW'

  const activeHold = await db.assignmentHold.findFirst({
    where: { jobRequestId: request.id, status: 'ACTIVE' },
    select: { id: true },
  })

  if (activeHold) {
    if (request.assignmentMode === targetAssignmentMode) {
      console.info('[matching-mode] noop — already in progress', { requestId: request.id, mode: params.mode })
      return { requestId: request.id, mode: params.mode, status: 'already_in_progress' as const }
    }
    console.info('[matching-mode] rejected — hold active', { requestId: request.id, mode: params.mode })
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
      const candidates = await getProviderCandidatesForCustomerReview({
        requestId: request.id,
        customerId: params.customerId,
        batch: 1,
      })

      reviewCandidateCount = candidates?.candidates?.length ?? 0
      console.info('[request-matching-mode] review-first candidates generated', {
        requestId: request.id,
        candidateCount: reviewCandidateCount,
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
      text =
        quickMatchResult?.status === 'NO_MATCH'
          ? `Quick Match started.\n\nNo providers in your area are available right now.\n\nWe'll keep trying and notify you the moment one becomes available.`
          : `Quick Match started.\n\nWe're checking with one suitable provider now.\nIf they don't respond, we'll try the next provider.`
    } else if (reviewFailed) {
      // Review-first mode requires an attempt to build provider options before the
      // customer is told they can shortlist providers.
      text = 'Review Providers First could not be prepared right now.\n\nYour request is saved. Please try again from your request link or send *Review Providers First* again.'
    } else if (reviewCandidateCount > 0) {
      text = `Review Providers First is ready.\n\nWe found ${reviewCandidateCount} matching provider${reviewCandidateCount === 1 ? '' : 's'} for your request.\n\nOpen your request to view matching provider profiles, shortlist 1 to 3 providers, and send your request only to the providers you choose.`
    } else {
      text = 'We couldn\'t find matching providers in your area right now.\n\nYou can try Quick Match, edit your request, or return to the main menu.'
    }

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
