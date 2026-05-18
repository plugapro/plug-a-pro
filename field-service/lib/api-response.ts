/**
 * Centralized API response helpers.
 *
 * All new API route handlers should use apiError() and apiSuccess() instead of
 * raw Response.json() calls. This ensures a consistent error envelope shape:
 *   { error: { code, message, referenceId? } }   — errors
 *   { data: T }                                   — successes
 *
 * TODO: Full envelope migration in progress — existing routes are being updated
 * incrementally. See task "ARCH DRIFT HIGH: Centralize API error envelope and
 * route action error adapters across field-service and marketing".
 */

export interface ApiError {
  code: string
  message: string
  referenceId?: string
}

/** Return a structured error response. */
export function apiError(
  code: string,
  message: string,
  status: number,
  referenceId?: string,
): Response {
  const body: { error: ApiError } = { error: { code, message } }
  if (referenceId) body.error.referenceId = referenceId
  return Response.json(body, { status })
}

/** Return a structured success response. */
export function apiSuccess<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status })
}
