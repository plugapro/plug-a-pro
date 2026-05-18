/**
 * API authentication helpers.
 *
 * Page routes use requireAdmin() / requireProvider() from lib/auth.ts — those redirect on failure.
 * API routes must NOT redirect; they must return structured JSON 401/403 responses.
 *
 * Use unauthorizedResponse() and forbiddenResponse() as the canonical response builders.
 * Use ApiAuthError when you need to throw and let a catch-block return the response.
 */

export class ApiAuthError extends Error {
  constructor(
    public readonly code: 'UNAUTHORIZED' | 'FORBIDDEN',
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'ApiAuthError'
  }
}

/** Returns a structured JSON 401 response. Use in API route handlers on auth failure. */
export function unauthorizedResponse(): Response {
  return Response.json(
    { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
    { status: 401 },
  )
}

/** Returns a structured JSON 403 response. Use in API route handlers on permission failure. */
export function forbiddenResponse(): Response {
  return Response.json(
    { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
    { status: 403 },
  )
}
