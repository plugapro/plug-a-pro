import { randomUUID } from 'crypto'
import { normalizePhone } from './utils'

export type DiagnosticCode =
  | 'INVALID_OTP'
  | 'OTP_EXPIRED'
  | 'OTP_PROVIDER_REJECTED'
  | 'WORKER_NOT_FOUND'
  | 'WORKER_NOT_APPROVED'
  | 'WORKER_INACTIVE'
  | 'WORKER_AUTH_IDENTITY_MISSING'
  | 'WORKER_ROLE_MISSING'
  | 'WORKER_PROFILE_LINK_MISSING'
  | 'DUPLICATE_WORKER_PROFILE'
  | 'AUTH_SESSION_MISSING'
  | 'UNKNOWN_WORKER_VERIFY_ERROR'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_NOT_APPROVED'
  | 'INVALID_MOBILE_NUMBER'
  | 'INVALID_PHONE_NUMBER'
  | 'UNSUPPORTED_COUNTRY_CODE'
  | 'AUTH_CONFIG_MISSING'
  | 'AUTH_RESPONSE_INVALID'
  | 'OTP_DELIVERY_FAILED'
  | 'OTP_PROVIDER_TIMEOUT'
  | 'OTP_PROVIDER_UNAVAILABLE'
  | 'OTP_PROVIDER_BAD_RESPONSE'
  | 'OTP_PROVIDER_AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_INACTIVE'
  | 'JOB_LINK_EXPIRED'
  | 'JOB_LINK_INVALID'
  | 'JOB_ACCESS_DENIED'
  | 'JOB_NOT_FOUND'
  | 'JOB_REASSIGNED'
  | 'JOB_CANCELLED'
  /** @deprecated No longer emitted by production code. Retained for historical log compatibility — use AUTH_RESPONSE_INVALID instead. */
  | 'UNKNOWN_AUTH_ERROR'
  // Customer-flow codes
  | 'REQUEST_SUBMISSION_FAILED'
  | 'PHOTO_UPLOAD_FAILED'
  | 'TICKET_EXPIRED'
  | 'TICKET_INVALID'
  // Credits lifecycle codes
  | 'INSUFFICIENT_CREDITS'
  | 'CREDIT_WALLET_SUSPENDED'
  | 'CREDIT_UNLOCK_FAILED'
  | 'CREDIT_TOPUP_DUPLICATE_CALLBACK'
  | 'CREDIT_TOPUP_PAYMENT_FAILED'
  | 'CREDIT_BALANCE_NEGATIVE_BLOCKED'
  | 'CREDIT_LEDGER_WRITE_FAILED'
  | 'CREDIT_RECONCILIATION_MISMATCH'
  | 'UNKNOWN_CREDIT_ERROR'

export function createTraceId(prefix = 'req') {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function timestamp() {
  return new Date().toISOString()
}

export function maskPhone(phone: string | null | undefined) {
  if (!phone) return undefined
  const normalized = normalizePhone(phone)
  const digits = normalized.replace(/\D/g, '')
  if (digits.length < 5) return '***'
  const local = digits.startsWith('27') ? `0${digits.slice(2)}` : digits
  return `${local.slice(0, 3)}****${local.slice(-3)}`
}

export function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}
