import { isIP } from 'node:net'
import { z } from 'zod'

function hasForbiddenRawValue(value: string): boolean {
  const lower = value.toLowerCase()

  return (
    lower.includes('access_token') ||
    lower.includes('bearer ') ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
    /(?:otp|code)[^\d]{0,16}\d{4,8}/i.test(value) ||
    /\b\d{6}\b/.test(value) ||
    /^\+?\d[\d\s-]{6,}$/.test(value) ||
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ||
    /^Mozilla\/\d/i.test(value) ||
    /^curl\/\d/i.test(value) ||
    isIP(value.trim()) !== 0
  )
}

const ForbiddenRawValue = z.string().refine((value) => !hasForbiddenRawValue(value), {
  message: 'metadata contains a disallowed raw value',
})

export const OtpChallengeContextSchema = z
  .object({
    traceId: ForbiddenRawValue.optional(),
    hookRequestId: ForbiddenRawValue.optional(),
    source: z
      .enum([
        'send_sms_hook',
        'session_gate',
        'report_api',
        'whatsapp_webhook',
        'verify_failed',
        'retention',
      ])
      .optional(),
    sourceRoute: ForbiddenRawValue.optional(),
    deliveryRefusedReason: z.enum(['locked', 'security_gate_unavailable']).optional(),
    challengeVerification: z.enum(['not_found', 'verified']).optional(),
  })
  .strip()

export const SecurityEventMetadataSchema = z
  .object({
    traceId: ForbiddenRawValue.optional(),
    reason: ForbiddenRawValue.optional(),
    windowStart: z.string().datetime().optional(),
    windowEnd: z.string().datetime().optional(),
    count: z.number().int().nonnegative().optional(),
    source: ForbiddenRawValue.optional(),
    sourceRoute: ForbiddenRawValue.optional(),
    relatedStatus: ForbiddenRawValue.optional(),
    userIdPresent: z.boolean().optional(),
  })
  .strip()

export type OtpChallengeContext = z.infer<typeof OtpChallengeContextSchema>
export type SecurityEventMetadata = z.infer<typeof SecurityEventMetadataSchema>

export function sanitizeChallengeContext(value: unknown): OtpChallengeContext {
  return OtpChallengeContextSchema.parse(value ?? {})
}

export function sanitizeSecurityEventMetadata(value: unknown): SecurityEventMetadata {
  return SecurityEventMetadataSchema.parse(value ?? {})
}
