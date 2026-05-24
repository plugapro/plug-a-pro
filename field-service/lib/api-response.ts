/**
 * Centralized API response helpers.
 *
 * All new API route handlers should use apiError() and apiSuccess() instead of
 * raw Response.json() calls. This ensures a consistent error envelope shape.
 *
 * TODO: Full envelope migration in progress — existing routes are being updated
 * incrementally. See task "ARCH DRIFT HIGH: Centralize API error envelope and
 * route action error adapters across field-service and marketing".
 */

export interface ApiError {
  code: string
  category: string
  message: string
  reference_id: string
  referenceId?: string
  retryable: boolean
  suggested_actions: string[]
  context: Record<string, unknown>
  timestamp: string
}

type ApiErrorOptions = {
  category?: string
  retryable?: boolean
  suggestedActions?: string[]
  context?: Record<string, unknown>
}

export function createApiReferenceId(prefix = 'PAP') {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0')
  return `${prefix}-${date}-${suffix}`
}

function categoryFor(status: number) {
  if (status === 401) return 'authentication'
  if (status === 403) return 'authorization'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 422 || status === 400) return 'validation'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'internal'
  return 'request'
}

function defaultSuggestedActions(status: number) {
  if (status === 401) return ['Sign in and try again.']
  if (status === 403) return ['Contact an administrator if this access is required.']
  if (status === 404) return ['Check the requested resource and try again.']
  if (status === 429) return ['Wait before retrying.']
  if (status >= 500) return ['Retry later or contact support with the reference ID.']
  return ['Review the request and try again.']
}

/** Return a structured error response. */
export function apiError(
  code: string,
  message: string,
  status: number,
  referenceId?: string,
  options: ApiErrorOptions = {},
): Response {
  const resolvedReferenceId = referenceId ?? createApiReferenceId()
  const body: { error: ApiError } = {
    error: {
      code,
      category: options.category ?? categoryFor(status),
      message,
      reference_id: resolvedReferenceId,
      referenceId: resolvedReferenceId,
      retryable: options.retryable ?? (status === 408 || status === 429 || status >= 500),
      suggested_actions: options.suggestedActions ?? defaultSuggestedActions(status),
      context: options.context ?? {},
      timestamp: new Date().toISOString(),
    },
  }
  return Response.json(body, { status })
}

/** Return a structured success response. */
export function apiSuccess<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status })
}
