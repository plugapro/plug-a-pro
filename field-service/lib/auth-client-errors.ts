export function getOtpVerifyErrorMessage(message?: string | null) {
  const normalized = (message ?? '').toLowerCase()

  if (
    normalized.includes('expired') ||
    normalized.includes('token has expired') ||
    normalized.includes('otp expired')
  ) {
    return 'Your code has expired. Please request a new one and try again.'
  }

  if (
    normalized.includes('invalid') ||
    normalized.includes('token') ||
    normalized.includes('otp') ||
    normalized.includes('code')
  ) {
    return 'Invalid code. Please check the 6-digit code from WhatsApp and try again.'
  }

  if (normalized.includes('rate') || normalized.includes('limit') || normalized.includes('too many')) {
    return 'Too many attempts. Please wait a few minutes before trying again.'
  }

  return 'We could not verify your code right now. Please try again.'
}
