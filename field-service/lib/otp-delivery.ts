import { randomUUID } from 'crypto'
import { db } from './db'
import { recordAuditLog } from './audit'
import { normalizeOtpPhoneNumber } from './phone-normalization'
import { sendTemplate } from './whatsapp'

const OTP_TEMPLATE_NAME = 'otp_login'

export type OtpDeliveryErrorCode =
  | 'UNSUPPORTED_COUNTRY_CODE'
  | 'INVALID_PHONE_NUMBER'
  | 'TEMPLATE_NOT_APPROVED'
  | 'WA_AUTH_FAILED'
  | 'WA_TRANSIENT'

export class OtpDeliveryError extends Error {
  readonly code: OtpDeliveryErrorCode
  constructor(code: OtpDeliveryErrorCode, message: string) {
    super(message)
    this.name = 'OtpDeliveryError'
    this.code = code
  }
}

export type DeliverOtpContext = {
  userId?: string | null
  hookRequestId?: string | null
  traceId?: string | null
}

export type DeliverOtpResult = {
  ok: true
  whatsappMessageId: string
  phoneE164: string
}

/**
 * Delivers a Supabase-generated OTP through the WhatsApp Cloud API.
 *
 * Security: the `code` argument MUST NEVER reach console.*, recordAuditLog,
 * the OtpDeliveryAttempt row or any other persisted field. Tests assert this.
 */
export async function deliverOtp(params: {
  phone: string
  code: string
  context?: DeliverOtpContext
}): Promise<DeliverOtpResult> {
  const ctx = params.context ?? {}
  const hookRequestId = ctx.hookRequestId ?? null
  const userId = ctx.userId ?? null
  const traceId = ctx.traceId ?? null

  const normalized = normalizeOtpPhoneNumber(params.phone, 'ZA')
  if (!normalized.ok) {
    const code: OtpDeliveryErrorCode = normalized.errorCode
    await writeAttempt({
      phoneE164: params.phone,
      userId,
      status: 'failed',
      failureCode: code,
      failureReason: normalized.reason,
      templateName: OTP_TEMPLATE_NAME,
      hookRequestId,
    }).catch(() => undefined)
    await recordAuditLog({
      actorId: userId || 'system',
      actorRole: 'auth_hook',
      action: 'auth.otp_send_failed',
      entityType: 'phone',
      entityId: params.phone,
      after: {
        channel: 'whatsapp',
        failureCode: code,
        templateName: OTP_TEMPLATE_NAME,
        hookRequestId,
        userId,
        traceId,
      } as any,
    }).catch(() => undefined)
    throw new OtpDeliveryError(code, normalized.reason)
  }

  const phoneE164 = normalized.e164
  const traceIdForSend = traceId ?? randomUUID()

  try {
    const whatsappMessageId = await sendTemplate({
      to: phoneE164,
      template: OTP_TEMPLATE_NAME as any,
      // Meta's authentication-category templates (otp_login here) include a
      // "Copy code" URL button. Per WhatsApp Cloud API, the button's URL
      // parameter must be supplied at send time - omitting it returns
      // (#131008) Required parameter is missing. The button parameter must
      // be the same OTP code as the body parameter.
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: params.code }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [{ type: 'text', text: params.code }],
        },
      ] as any,
      allowTestCohortOverride: true,
      metadata: {
        purpose: 'auth_otp',
        traceId: traceIdForSend,
        hookRequestId,
        userId,
      },
    })

    await writeAttempt({
      phoneE164,
      userId,
      status: 'sent',
      whatsappMessageId,
      templateName: OTP_TEMPLATE_NAME,
      hookRequestId,
    }).catch(() => undefined)

    await recordAuditLog({
      actorId: userId || 'system',
      actorRole: 'auth_hook',
      action: 'auth.otp_send',
      entityType: 'phone',
      entityId: phoneE164,
      after: {
        channel: 'whatsapp',
        whatsappMessageId,
        templateName: OTP_TEMPLATE_NAME,
        hookRequestId,
        userId,
        traceId: traceIdForSend,
      } as any,
    }).catch(() => undefined)

    return { ok: true, whatsappMessageId, phoneE164 }
  } catch (err) {
    const classified = classifyWhatsAppError(err)
    // Log the raw Meta error before classification so future delivery failures
    // can be diagnosed from a single log line. The classifier collapses every
    // unmatched error into WA_TRANSIENT, which previously hid a missing
    // URL-button parameter (#131008) behind a generic "WhatsApp delivery
    // failed; please retry." - easy to mis-diagnose as a transient blip.
    // Safe to log: this is the upstream error message, never the OTP code or
    // tokens (sendTemplate redacts those before throwing).
    console.error('[otp-delivery] WhatsApp send failed', {
      hookRequestId,
      traceId: traceIdForSend,
      templateName: OTP_TEMPLATE_NAME,
      classifiedCode: classified.code,
      rawError: err instanceof Error ? err.message : String(err),
    })
    await writeAttempt({
      phoneE164,
      userId,
      status: 'failed',
      failureCode: classified.code,
      failureReason: classified.reason,
      templateName: OTP_TEMPLATE_NAME,
      hookRequestId,
    }).catch(() => undefined)
    await recordAuditLog({
      actorId: userId || 'system',
      actorRole: 'auth_hook',
      action: 'auth.otp_send_failed',
      entityType: 'phone',
      entityId: phoneE164,
      after: {
        channel: 'whatsapp',
        failureCode: classified.code,
        templateName: OTP_TEMPLATE_NAME,
        hookRequestId,
        userId,
        traceId: traceIdForSend,
      } as any,
    }).catch(() => undefined)
    throw new OtpDeliveryError(classified.code, classified.reason)
  }
}

function classifyWhatsAppError(err: unknown): {
  code: OtpDeliveryErrorCode
  reason: string
} {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('[TEMPLATE_NOT_APPROVED]')) {
    return {
      code: 'TEMPLATE_NOT_APPROVED',
      reason: 'WhatsApp OTP template is not approved.',
    }
  }
  const lower = message.toLowerCase()
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('auth') && lower.includes('token')
  ) {
    return {
      code: 'WA_AUTH_FAILED',
      reason: 'WhatsApp Cloud API authentication failed.',
    }
  }
  return {
    code: 'WA_TRANSIENT',
    reason: 'WhatsApp delivery failed; please retry.',
  }
}

async function writeAttempt(params: {
  phoneE164: string
  userId: string | null
  status: 'sent' | 'failed'
  whatsappMessageId?: string
  failureCode?: string
  failureReason?: string
  templateName: string
  hookRequestId: string | null
}): Promise<void> {
  await db.otpDeliveryAttempt.create({
    data: {
      phoneE164: params.phoneE164,
      userId: params.userId ?? null,
      channel: 'whatsapp',
      status: params.status,
      whatsappMessageId: params.whatsappMessageId ?? null,
      failureCode: params.failureCode ?? null,
      failureReason: params.failureReason ?? null,
      templateName: params.templateName,
      hookRequestId: params.hookRequestId,
    },
  })
}
