import { createHash, randomInt } from 'crypto'
import { db } from './db'

// Alphanumeric set excluding visually ambiguous characters O/0 and I/1
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generatePublicErrorRef(): string {
  const chars = Array.from({ length: 5 }, () => REF_CHARS[randomInt(0, REF_CHARS.length)])
  return `PAP-${chars.join('')}`
}

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 16)
}

const REDACT_KEYS = [
  'phone', 'email', 'password', 'otp', 'token', 'idnumber', 'id_number',
  'authorization', 'apikey', 'api_key', 'secret', 'session', 'cookie',
]

function redactPayload(obj: unknown, depth = 0): unknown {
  if (depth > 4 || obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.slice(0, 20).map((item) => redactPayload(item, depth + 1))
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_KEYS.some((r) => key.toLowerCase().includes(r))) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = redactPayload(value, depth + 1)
    }
  }
  return result
}

export type ApplicationErrorInput = {
  traceId: string
  source: string
  workflow: string
  step: string
  userId?: string | null
  providerApplicationId?: string | null
  whatsappPhone?: string | null
  errorCode: string
  errorCategory: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  retryable: boolean
  technicalMessage?: string | null
  stackTrace?: string | null
  requestPayload?: unknown
  responsePayload?: unknown
  metadata?: Record<string, unknown>
}

export type ApplicationErrorResult = {
  publicRef: string
  userMessage: string
}

export async function captureApplicationError(
  input: ApplicationErrorInput,
): Promise<ApplicationErrorResult> {
  const publicRef = generatePublicErrorRef()
  const phoneHash = input.whatsappPhone ? hashPhone(input.whatsappPhone) : null

  const userMessage = [
    "Sorry, we couldn't submit your application right now.",
    '',
    'Your progress has been saved. Please try again in a few minutes.',
    '',
    'If the issue continues, contact support and share this reference:',
    publicRef,
  ].join('\n')

  // Structured log — both publicRef and traceId present for correlation
  console.error('[application-error-service] application_submit_failed', {
    event: 'application_submit_failed',
    public_error_ref: publicRef,
    trace_id: input.traceId,
    workflow: input.workflow,
    step: input.step,
    source: input.source,
    error_code: input.errorCode,
    error_category: input.errorCategory,
    severity: input.severity,
    retryable: input.retryable,
    provider_application_id: input.providerApplicationId ?? null,
    user_id: input.userId ?? null,
  })

  try {
    const safeRequest = input.requestPayload != null
      ? (redactPayload(input.requestPayload) as object)
      : undefined
    const safeResponse = input.responsePayload != null
      ? (redactPayload(input.responsePayload) as object)
      : undefined

    await db.applicationErrorEvent.create({
      data: {
        publicErrorRef: publicRef,
        traceId: input.traceId,
        source: input.source,
        workflow: input.workflow,
        step: input.step,
        userId: input.userId ?? null,
        providerApplicationId: input.providerApplicationId ?? null,
        whatsappPhoneHash: phoneHash,
        errorCode: input.errorCode,
        errorCategory: input.errorCategory,
        severity: input.severity,
        retryable: input.retryable,
        userSafeMessage: userMessage,
        technicalMessage: input.technicalMessage ?? null,
        stackTrace: input.stackTrace ?? null,
        requestPayloadSummary: safeRequest,
        responsePayloadSummary: safeResponse,
        metadata: input.metadata ?? {},
      },
    })
  } catch (persistErr) {
    // Persistence is non-fatal — the user still gets a safe message
    console.error('[application-error-service] failed to persist error event', {
      public_error_ref: publicRef,
      trace_id: input.traceId,
      error: persistErr instanceof Error ? persistErr.message : String(persistErr),
    })
  }

  return { publicRef, userMessage }
}
