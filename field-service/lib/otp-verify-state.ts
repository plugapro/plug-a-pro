export const OTP_VERIFY_STATE_TTL_MS = 10 * 60 * 1000
export const CUSTOMER_OTP_VERIFY_STORAGE_KEY = 'plugapro:customer-otp-verify'
export const PROVIDER_OTP_VERIFY_STORAGE_KEY = 'plugapro:provider-otp-verify'

export type OtpVerifyState = {
  phone: string
  next?: string
  name?: string
  intent?: string
  savedAt: number
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function serializeOtpVerifyState(state: OtpVerifyState): string {
  return JSON.stringify(state)
}

export function parseOtpVerifyState(raw: string | null | undefined, now = Date.now()): OtpVerifyState | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const phone = nonEmptyString(parsed.phone)
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : undefined

    if (!phone || !savedAt) return null
    if (now - savedAt > OTP_VERIFY_STATE_TTL_MS) return null

    return {
      phone,
      next: nonEmptyString(parsed.next),
      name: nonEmptyString(parsed.name),
      intent: nonEmptyString(parsed.intent),
      savedAt,
    }
  } catch {
    return null
  }
}

export function saveOtpVerifyState(storage: Pick<Storage, 'setItem'>, key: string, state: OtpVerifyState): void {
  try {
    storage.setItem(key, serializeOtpVerifyState(state))
  } catch {
    // Some in-app/private browser modes can reject storage. OTP still works
    // from the URL state; this persistence is only recovery hardening.
  }
}

export function loadOtpVerifyState(storage: Pick<Storage, 'getItem'>, key: string): OtpVerifyState | null {
  try {
    return parseOtpVerifyState(storage.getItem(key))
  } catch {
    return null
  }
}
