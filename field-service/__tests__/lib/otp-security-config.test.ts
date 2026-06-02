import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getOtpSecurityConfig native report mode', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.OTP_SECURITY_REPORT_DELIVERY_MODE
  })

  async function loadConfig() {
    process.env.VITEST = 'true'
    const { getOtpSecurityConfig } = await import('@/lib/otp-security-config')
    return getOtpSecurityConfig()
  }

  it('defaults to the utility follow-up prompt for safe rollout fallback', async () => {
    await expect(loadConfig()).resolves.toMatchObject({
      reportDeliveryMode: 'utility_followup',
    })
  })

  it('accepts native_auth_button when Meta beta access is enabled for the WABA', async () => {
    process.env.OTP_SECURITY_REPORT_DELIVERY_MODE = 'native_auth_button'

    await expect(loadConfig()).resolves.toMatchObject({
      reportDeliveryMode: 'native_auth_button',
    })
  })

  it('falls back to utility_followup for unknown values', async () => {
    process.env.OTP_SECURITY_REPORT_DELIVERY_MODE = 'unsupported'

    await expect(loadConfig()).resolves.toMatchObject({
      reportDeliveryMode: 'utility_followup',
    })
  })
})
