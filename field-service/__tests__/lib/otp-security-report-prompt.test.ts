import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendTemplate: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({ sendTemplate: mocks.sendTemplate }))

const PHONE = '+27821234567'
const TOKEN = 'rT3PoRtToK3n.abcdef1234567890'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sendTemplate.mockResolvedValue('wamid.security_check.1')
})

describe('sendOtpSecurityCheckBestEffort', () => {
  it('sends the otp_security_check template with the correct quick-reply payload', async () => {
    const { sendOtpSecurityCheckBestEffort } = await import('@/lib/otp-security-report-prompt')
    const result = await sendOtpSecurityCheckBestEffort({
      phone: PHONE,
      reportToken: TOKEN,
      trigger: 'send_velocity',
      hookRequestId: 'hook_abc',
      userId: 'user_123',
    })

    expect(result).toEqual({ sent: true, messageId: 'wamid.security_check.1' })
    expect(mocks.sendTemplate).toHaveBeenCalledTimes(1)
    const call = mocks.sendTemplate.mock.calls[0][0]
    expect(call.to).toBe(PHONE)
    expect(call.template).toBe('otp_security_check')
    expect(call.components).toEqual([
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: 0,
        parameters: [{ type: 'payload', payload: `otp_report_${TOKEN}` }],
      },
    ])
    expect(call.metadata).toMatchObject({
      purpose: 'otp_security_check',
      trigger: 'send_velocity',
      hookRequestId: 'hook_abc',
      userId: 'user_123',
    })
  })

  it('uses the inbound-handler-compatible button payload format', async () => {
    const { sendOtpSecurityCheckBestEffort } = await import('@/lib/otp-security-report-prompt')
    await sendOtpSecurityCheckBestEffort({
      phone: PHONE,
      reportToken: TOKEN,
      trigger: 'ip_diversity',
    })
    const call = mocks.sendTemplate.mock.calls[0][0]
    const payload = call.components[0].parameters[0].payload
    // The inbound handler in lib/whatsapp-bot.ts strips the OTP_REPORT_BUTTON_PREFIX
    // ('otp_report_') and uses the remainder as the report token.
    expect(payload.startsWith('otp_report_')).toBe(true)
    expect(payload.slice('otp_report_'.length)).toBe(TOKEN)
  })

  it('returns sent=false and logs structured warning on template failure (never throws)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.sendTemplate.mockRejectedValueOnce(new Error('[TEMPLATE_NOT_APPROVED] otp_security_check not approved'))

    const { sendOtpSecurityCheckBestEffort } = await import('@/lib/otp-security-report-prompt')
    const result = await sendOtpSecurityCheckBestEffort({
      phone: PHONE,
      reportToken: TOKEN,
      trigger: 'prior_event',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('TEMPLATE_NOT_APPROVED')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string)
    expect(logged).toMatchObject({
      event: 'otp.security_check.send_failed',
      trigger: 'prior_event',
      templateNotApproved: true,
    })
    warnSpy.mockRestore()
  })

  it('redacts the raw report token from any error message', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.sendTemplate.mockRejectedValueOnce(
      new Error(`upstream failure carrying ${TOKEN} accidentally`),
    )
    const { sendOtpSecurityCheckBestEffort } = await import('@/lib/otp-security-report-prompt')
    const result = await sendOtpSecurityCheckBestEffort({
      phone: PHONE,
      reportToken: TOKEN,
      trigger: 'send_velocity',
    })

    expect(result.reason).not.toContain(TOKEN)
    expect(result.reason).toContain('<redacted-report-token>')
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string)
    expect(logged.reason).not.toContain(TOKEN)
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(TOKEN)
    warnSpy.mockRestore()
  })
})
