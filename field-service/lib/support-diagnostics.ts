import { randomUUID } from 'crypto'
import { normalizePhone } from './utils'

export type DiagnosticCode =
  | 'PROVIDER_NOT_FOUND'
  | 'INVALID_PHONE_NUMBER'
  | 'UNSUPPORTED_COUNTRY_CODE'
  | 'OTP_DELIVERY_FAILED'
  | 'OTP_PROVIDER_TIMEOUT'
  | 'OTP_PROVIDER_UNAVAILABLE'
  | 'OTP_PROVIDER_BAD_RESPONSE'
  | 'RATE_LIMITED'
  | 'PROVIDER_INACTIVE'
  | 'JOB_LINK_EXPIRED'
  | 'JOB_LINK_INVALID'
  | 'JOB_ACCESS_DENIED'
  | 'JOB_NOT_FOUND'
  | 'JOB_REASSIGNED'
  | 'JOB_CANCELLED'
  | 'UNKNOWN_AUTH_ERROR'

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
