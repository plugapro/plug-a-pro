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

  if (
    normalized.includes('rate') ||
    normalized.includes('limit') ||
    normalized.includes('too many')
  ) {
    return 'Too many attempts. Please wait a few minutes before trying again.'
  }

  if (
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('fetch failed')
  ) {
    return 'Network issue while verifying. Please try again when your connection is stable.'
  }

  return 'We could not verify your code right now. Please try again.'
}

export type CustomerOtpSendErrorCode =
  | 'INVALID_PHONE_NUMBER'
  | 'RATE_LIMITED'
  | 'WHATSAPP_BLOCKED'
  | 'PROVIDER_AUTH'
  | 'NETWORK'
  | 'UNKNOWN'

export function getCustomerOtpSendErrorMessage(message?: string | null): string {
  const normalized = (message ?? '').toLowerCase()
  const code = getCustomerOtpSendErrorCode(normalized)

  switch (code) {
    case 'INVALID_PHONE_NUMBER':
      return 'Please enter a valid South African mobile number.'
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a few minutes before trying again.'
    case 'WHATSAPP_BLOCKED':
      return 'We could not deliver your code on WhatsApp. Check the number and try again or contact support@plugapro.co.za.'
    case 'PROVIDER_AUTH':
      return 'Your account is not configured to request codes from this surface right now. Contact support@plugapro.co.za.'
    case 'NETWORK':
      return 'Network issue while sending your code. Please try again when your connection is stable.'
    default:
      return 'Could not send code. Please try again or contact support@plugapro.co.za.'
  }
}

function getCustomerOtpSendErrorCode(normalized: string): CustomerOtpSendErrorCode {
  if (
    normalized.includes('otp_whatsapp_disabled') ||
    normalized.includes('template_not_approved') ||
    normalized.includes('wa_auth_failed') ||
    normalized.includes('wa_transient') ||
    normalized.includes('unsupported') ||
    normalized.includes('not enabled') ||
    (normalized.includes('phone') && normalized.includes('provider'))
  ) {
    return 'WHATSAPP_BLOCKED'
  }

  if (normalized.includes('rate') || normalized.includes('limit') || normalized.includes('too many')) {
    return 'RATE_LIMITED'
  }

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('invalid api key') ||
    normalized.includes('api key') ||
    normalized.includes('apikey') ||
    normalized.includes('signup is disabled') ||
    normalized.includes('signups are disabled') ||
    normalized.includes('signups not allowed')
  ) {
    return 'PROVIDER_AUTH'
  }

  if (
    normalized.includes('invalid') ||
    normalized.includes('format') ||
    normalized.includes('unsupported country') ||
    normalized.includes('mobile number') ||
    normalized.includes('phone number')
  ) {
    return 'INVALID_PHONE_NUMBER'
  }

  if (
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch failed')
  ) {
    return 'NETWORK'
  }

  return 'UNKNOWN'
}
