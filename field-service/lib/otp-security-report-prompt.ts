import { sendTemplate } from './whatsapp'
import type { SecurityCheckTrigger } from './otp-security-signals'

const TEMPLATE_NAME = 'otp_security_check' as const

export type SendOtpSecurityCheckParams = {
  phone: string // E.164 with leading +
  reportToken: string // raw token; payload becomes `otp_report_<reportToken>`
  trigger: SecurityCheckTrigger
  /** Trace correlator from the send-sms hook. */
  hookRequestId?: string | null
  /** Optional Supabase user id. Forwarded only to the cohort-gate metadata. */
  userId?: string | null
}

/**
 * Fire-and-forget outbound for the `otp_security_check` UTILITY template.
 *
 * Best-effort by contract: every failure path logs a structured event and
 * returns. The OTP delivery is already successful by the time this runs;
 * we must never let a follow-up message take the sign-in flow down.
 *
 * The button payload is `otp_report_<reportToken>`, which matches the
 * existing inbound handler at lib/whatsapp-bot.ts:1019 (`OTP_REPORT_BUTTON_PREFIX`).
 */
export async function sendOtpSecurityCheckBestEffort(
  params: SendOtpSecurityCheckParams,
): Promise<{ sent: boolean; messageId?: string; reason?: string }> {
  const buttonPayload = `otp_report_${params.reportToken}`
  try {
    const messageId = await sendTemplate({
      to: params.phone,
      template: TEMPLATE_NAME,
      components: [
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: 0,
          parameters: [{ type: 'payload', payload: buttonPayload }],
        },
      ] as any,
      metadata: {
        purpose: 'otp_security_check',
        trigger: params.trigger,
        hookRequestId: params.hookRequestId,
        userId: params.userId,
      },
    })

    // Structured success log so we can grep for triggered prompts in production.
    // No raw token, no full phone - only the trigger reason + masked metadata.
    console.info(
      JSON.stringify({
        event: 'otp.security_check.sent',
        trigger: params.trigger,
        whatsappMessageId: messageId,
        hookRequestId: params.hookRequestId ?? null,
        userIdPresent: Boolean(params.userId),
      }),
    )

    return { sent: true, messageId }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // Strip the raw report token if it accidentally landed in the error.
    // sendTemplate already redacts tokens before throwing, but defence in depth.
    const safeReason = reason.includes(params.reportToken)
      ? reason.split(params.reportToken).join('<redacted-report-token>')
      : reason

    console.warn(
      JSON.stringify({
        event: 'otp.security_check.send_failed',
        trigger: params.trigger,
        hookRequestId: params.hookRequestId ?? null,
        userIdPresent: Boolean(params.userId),
        reason: safeReason,
        // Surface TEMPLATE_NOT_APPROVED explicitly so an unapproved template
        // shows up in logs immediately rather than as a generic transient.
        templateNotApproved: safeReason.includes('[TEMPLATE_NOT_APPROVED]'),
      }),
    )

    return { sent: false, reason: safeReason }
  }
}
