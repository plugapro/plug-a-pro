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
    await getProviderCandidatesForCustomerReview({
      requestId: request.id,
      batch: 1,
    }).catch((error) => {
      console.error('[request-matching-mode] review-first candidate generation failed', {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  } else if (nextStatus === 'OPEN') {
    await orchestrateMatch(request.id, { triggeredBy: 'manual' }).catch((error) => {
      console.error('[request-matching-mode] matching trigger failed', {
        requestId: request.id,
        mode: params.mode,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  if (request.customer?.phone) {
    const text = params.mode === 'quick_match'
      ? `Quick Match started.\n\nWe're checking with one suitable provider now.\nIf they don't respond, we'll try the next provider.`
      : `Review Providers First started.\n\nWe're collecting suitable provider responses so you can compare options before choosing.`
    await sendText(
      request.customer.phone,
      text,
      {
        templateName: 'interactive:client_matching_mode_selected',
        metadata: {
          requestId: request.id,
          mode: params.mode,
        },
      },
    ).catch((error) => {
      console.warn('[request-matching-mode] customer matching mode notification failed', {
        requestId: request.id,
        mode: params.mode,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  return {
    requestId: request.id,
    mode: params.mode,
    status:
      params.mode === 'review_first'
        ? 'review_options_ready'
        : nextStatus === 'OPEN'
          ? 'matching_started'
          : 'already_in_progress',
  } as const
}
