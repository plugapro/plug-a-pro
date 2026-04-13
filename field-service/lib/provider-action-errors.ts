type ProviderActionKind = 'status' | 'photo' | 'quote'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

export function getProviderStatusRouteErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)

  if (message.includes('Invalid job transition')) {
    return 'This job can no longer move to that step. Refresh the page and try again.'
  }

  if (message.includes('Job not found')) {
    return 'This job is no longer available in your queue.'
  }

  return 'We could not update the job right now. Please try again.'
}

export function getProviderPhotoRouteErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)

  if (message.includes('Only image files')) {
    return 'Please upload a valid photo file.'
  }

  if (message.includes('10MB') || message.toLowerCase().includes('too large')) {
    return 'Photo is too large. Use an image under 10 MB.'
  }

  return 'We could not upload the photo right now. Please try again.'
}

export function getProviderActionClientErrorMessage(params: {
  action: ProviderActionKind
  status?: number
  error?: string | null
}): string {
  const { action, status, error } = params

  if (status === 401) {
    return 'Your session has expired. Sign in again to continue.'
  }

  if (status === 403 || status === 404) {
    if (action === 'status') {
      return 'This job is no longer available to you.'
    }

    if (action === 'photo') {
      return 'You can only upload photos for your own active jobs.'
    }

    return 'This quote request is no longer available to you.'
  }

  if (status === 400 && error) {
    return error
  }

  if (status === 422 && error) {
    return error
  }

  return action === 'status'
    ? 'We could not update the job right now. Check your connection and try again.'
    : action === 'photo'
      ? 'We could not upload the photo right now. Check your connection and try again.'
      : 'We could not send the quote right now. Check your connection and try again.'
}
