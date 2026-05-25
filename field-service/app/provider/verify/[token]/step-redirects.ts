// Maps the result (or failure) of a verification step into a safe in-flow URL.
//
// The verify page renders inside the root error boundary, so any error that
// escapes a Server Action becomes the generic "Something went wrong" screen
// (with a digest such as "Error ID: 851128277"). To keep the flow recoverable,
// every step resolves to a redirect target instead of throwing:
//   - expected validation failures -> a controlled prompt on the same step
//   - expired/invalid tokens        -> reload (the page renders the expired view)
//   - stale/invalid transitions     -> reload current persisted state
//   - anything unexpected           -> stay on the step with a recoverable message
//
// Errors are classified by name (not `instanceof`) so the logic is robust to
// module mocking and to errors that crossed a serialization boundary.

import { logIdentityVerificationError, maskToken } from '@/lib/identity-verification/log'

const GENERIC_STEP_ERROR = 'That step could not be completed. Please try again.'

// The redirect helpers only need to know whether a step succeeded, plus the
// message for an identifier validation failure. A single permissive shape keeps
// them decoupled from the precise discriminated unions the actions return.
export type StepResult = {
  ok: boolean
  code?: string
  missingDocuments?: string[]
  message?: string
}

const DEFAULT_IDENTIFIER_ERROR = 'Check the document details and try again.'
const DOCUMENT_REQUIREMENTS_ERROR = 'Document requirements are unavailable. Please restart this verification step.'

export function basePath(token: string): string {
  return `/provider/verify/${token}`
}

export function documentStepRedirect(token: string, result: StepResult): string {
  if (result.ok) return basePath(token)
  if (result.code === 'INVALID_IDENTITY_BASIS') {
    return `${basePath(token)}?upload_error=${encodeURIComponent(DOCUMENT_REQUIREMENTS_ERROR)}`
  }
  return `${basePath(token)}?missing=document`
}

export function selfieStepRedirect(token: string, result: StepResult): string {
  return result.ok ? basePath(token) : `${basePath(token)}?missing=selfie`
}

export function identifierStepRedirect(token: string, result: StepResult): string {
  return result.ok
    ? basePath(token)
    : `${basePath(token)}?error=${encodeURIComponent(result.message ?? DEFAULT_IDENTIFIER_ERROR)}`
}

export function reviewStepRedirect(token: string, result: StepResult): string {
  if (result.ok) return basePath(token)
  if (result.code === 'INVALID_IDENTITY_BASIS') {
    return `${basePath(token)}?upload_error=${encodeURIComponent(DOCUMENT_REQUIREMENTS_ERROR)}`
  }
  return `${basePath(token)}?missing=document`
}

export function mapVerificationActionError(
  token: string,
  error: unknown,
  context: Record<string, unknown> = {},
): string {
  const name = errorName(error)
  logIdentityVerificationError('verify.action.failed', error, { token: maskToken(token), ...context })

  // Token problems: reload so the page renders its expired/invalid view.
  if (name === 'ProviderVerificationTokenError') return basePath(token)
  // Stale or out-of-order transition (e.g. double submit): reload current state.
  if (name === 'IdentityVerificationTransitionError') return basePath(token)
  // Anything else: keep the user on the step with a recoverable, generic message.
  return `${basePath(token)}?upload_error=${encodeURIComponent(GENERIC_STEP_ERROR)}`
}

function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null | undefined)?.name
  return typeof name === 'string' ? name : ''
}
