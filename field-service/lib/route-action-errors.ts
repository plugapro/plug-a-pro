function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

export function getDispatchRouteError(params: {
  action: 'assign' | 'override' | 'candidates'
  error: unknown
}): { status: number; message: string } {
  const message = getErrorMessage(params.error)

  if (message.includes('JOB_REQUEST_NOT_FOUND')) {
    return {
      status: 404,
      message: 'This request is no longer available in the dispatch queue.',
    }
  }

  if (params.action === 'candidates') {
    return {
      status: 422,
      message: 'We could not refresh ranked candidates right now. Refresh the queue and try again.',
    }
  }

  return {
    status: 422,
    message: 'Dispatch action could not be completed right now. Refresh the queue and try again.',
  }
}

export function getProviderExtraWorkRouteError(error: unknown): { status: number; message: string } {
  const message = getErrorMessage(error)

  if (message.includes('Job not found')) {
    return {
      status: 404,
      message: 'This job is no longer available in your queue.',
    }
  }

  if (message.includes('Invalid job transition')) {
    return {
      status: 409,
      message: 'This job can no longer request extra work from its current state. Refresh the page and try again.',
    }
  }

  return {
    status: 422,
    message: 'We could not send the extra-work request right now. Please try again.',
  }
}

export function getPublicQuoteDecisionError(params: {
  code?: string | null
}): { status: number; message: string } {
  switch (params.code) {
    case 'NOT_FOUND':
      return { status: 404, message: 'This quote is no longer available.' }
    case 'ALREADY_ACTIONED':
      return {
        status: 409,
        message: 'This quote has already been updated. Refresh the page to see the latest status.',
      }
    case 'EXPIRED':
      return {
        status: 410,
        message: 'This quote has expired. Please contact the provider to request a new one.',
      }
    case 'MISSING_PREFERRED_DATE':
      return {
        status: 409,
        message: 'This quote is missing a preferred job date. Ask the provider to resend it with a date.',
      }
    case 'AWAITING_PROVIDER_QUOTE':
      return {
        status: 409,
        message:
          "The provider hasn't sent their detailed quote yet. We'll notify you on WhatsApp as soon as it's ready.",
      }
    default:
      return {
        status: 422,
        message: 'We could not update this quote right now. Please try again.',
      }
  }
}
