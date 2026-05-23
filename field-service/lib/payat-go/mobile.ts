import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import { PayAtGoValidationError } from './errors'

/**
 * Normalizes South African mobile numbers to E.164 (+27XXXXXXXXX),
 * matching the Pay@Go OpenAPI pattern for customer/notification numbers.
 */
export function normalizePayAtGoMobile(rawPhone: string): string {
  const normalized = normalizeOtpPhoneNumber(rawPhone, 'ZA')
  if (!normalized.ok) {
    throw new PayAtGoValidationError('Enter a valid South African mobile number.')
  }
  return normalized.e164
}

export function maskPhone(rawPhone: string | null | undefined): string {
  if (!rawPhone) return '***'
  const digits = rawPhone.replace(/\D/g, '')
  if (digits.length <= 4) return '***'
  return `***${digits.slice(-4)}`
}
