// Structured, PII-safe logging for the identity verification flow.
//
// These logs are the breadcrumb trail for the document -> selfie transition.
// Never log raw identifiers (SA ID numbers, passport numbers) or access tokens;
// pass only IDs, statuses, document kinds, and coarse file metadata.

export type IdentityLogContext = Record<string, unknown>

type DescribedError = {
  name: string
  code?: string
  message: string
}

export function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return {
      name: error.name,
      ...(typeof code === 'string' ? { code } : {}),
      message: error.message,
    }
  }
  return { name: 'UnknownError', message: String(error) }
}

// Tokens are secrets — only keep a short, non-reversible prefix for correlation.
export function maskToken(token: string | null | undefined): string | null {
  if (!token) return null
  return token.length <= 8 ? '***' : `${token.slice(0, 6)}…`
}

export function logIdentityVerificationEvent(event: string, context: IdentityLogContext = {}): void {
  console.info(`[identity-verification] ${event}`, context)
}

export function logIdentityVerificationError(
  event: string,
  error: unknown,
  context: IdentityLogContext = {},
): void {
  console.error(`[identity-verification] ${event}`, { ...context, error: describeError(error) })
}
