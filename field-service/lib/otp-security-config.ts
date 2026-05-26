export type OtpSecurityConfig = {
  otpExpiryMinutes: number
  maxVerifyAttempts: number
  lockMinutesAfterReport: number
  lockRefusalEventWindowMinutes: number
  challengeRetentionDays: number
  adminAlertThreshold: number
  otpHashPepper: string
  stepUpCookieKey: string | null
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getOtpSecurityConfig(): OtpSecurityConfig {
  const pepper = process.env.OTP_HASH_PEPPER?.trim()

  if (!pepper && process.env.NODE_ENV === 'production') {
    throw new Error('OTP_HASH_PEPPER is required for OTP security in production')
  }

  return {
    otpExpiryMinutes: envInt('OTP_EXPIRY_MINUTES', 10),
    maxVerifyAttempts: envInt('OTP_MAX_VERIFY_ATTEMPTS', 5),
    lockMinutesAfterReport: envInt('OTP_LOCK_MINUTES_AFTER_UNREQUESTED_REPORT', 60),
    lockRefusalEventWindowMinutes: envInt('OTP_LOCK_REFUSAL_EVENT_WINDOW_MINUTES', 15),
    challengeRetentionDays: envInt('OTP_CHALLENGE_RETENTION_DAYS', 30),
    adminAlertThreshold: envInt('SECURITY_EVENTS_ADMIN_ALERT_THRESHOLD', 3),
    otpHashPepper: pepper || 'test-only-otp-security-pepper',
    stepUpCookieKey: process.env.STEP_UP_COOKIE_KEY?.trim() || null,
  }
}
