export type OtpSecurityConfig = {
  otpExpiryMinutes: number
  maxVerifyAttempts: number
  lockMinutesAfterReport: number
  lockRefusalEventWindowMinutes: number
  challengeRetentionDays: number
  /** Default 365 days. Drops historical security_events older than this. */
  securityEventRetentionDays: number
  /** Default 180 days. Drops account_security_states rows that have been
   *  fully cleared (no active lock, no step-up pending) and haven't been
   *  touched for this many days. */
  accountSecurityStateRetentionDays: number
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

function isTestRuntime(): boolean {
  // Vitest sets VITEST=true automatically; NODE_ENV=test is the conventional
  // Node test marker. Either is sufficient. Any other env (including
  // 'staging', 'preview' or unset) is treated as a non-test runtime and
  // requires a real pepper.
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
}

export function getOtpSecurityConfig(): OtpSecurityConfig {
  const pepper = process.env.OTP_HASH_PEPPER?.trim()

  if (!pepper && !isTestRuntime()) {
    throw new Error(
      'OTP_HASH_PEPPER is required outside of test runtimes (NODE_ENV=test or VITEST=true)',
    )
  }

  return {
    otpExpiryMinutes: envInt('OTP_EXPIRY_MINUTES', 10),
    maxVerifyAttempts: envInt('OTP_MAX_VERIFY_ATTEMPTS', 5),
    lockMinutesAfterReport: envInt('OTP_LOCK_MINUTES_AFTER_UNREQUESTED_REPORT', 60),
    lockRefusalEventWindowMinutes: envInt('OTP_LOCK_REFUSAL_EVENT_WINDOW_MINUTES', 15),
    challengeRetentionDays: envInt('OTP_CHALLENGE_RETENTION_DAYS', 30),
    securityEventRetentionDays: envInt('SECURITY_EVENT_RETENTION_DAYS', 365),
    accountSecurityStateRetentionDays: envInt('ACCOUNT_SECURITY_STATE_RETENTION_DAYS', 180),
    adminAlertThreshold: envInt('SECURITY_EVENTS_ADMIN_ALERT_THRESHOLD', 3),
    otpHashPepper: pepper || 'test-only-otp-security-pepper',
    stepUpCookieKey: process.env.STEP_UP_COOKIE_KEY?.trim() || null,
  }
}
