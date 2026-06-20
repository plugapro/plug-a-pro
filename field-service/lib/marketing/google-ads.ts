// Env-driven Google Ads conversion firing. Per-event labels are env-gated so the
// helper is a no-op until the right NEXT_PUBLIC_* vars are set in prod — that
// way preview/dev never reports inflated conversions to a live Ads account.

export type GoogleAdsConversionEvent =
  | 'quote'
  | 'booking'
  | 'payment'
  | 'whatsapp'
  | 'phone'

export interface GoogleAdsConversionParams {
  value?: number
  currency?: string
  transactionId?: string
}

type GtagWindow = typeof window & {
  gtag?: (...args: unknown[]) => void
}

const LABEL_ENV_BY_EVENT: Record<GoogleAdsConversionEvent, string | undefined> = {
  quote: process.env.NEXT_PUBLIC_GOOGLE_ADS_QUOTE_CONVERSION_LABEL,
  booking: process.env.NEXT_PUBLIC_GOOGLE_ADS_BOOKING_CONVERSION_LABEL,
  payment: process.env.NEXT_PUBLIC_GOOGLE_ADS_PAYMENT_CONVERSION_LABEL,
  whatsapp: process.env.NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_CONVERSION_LABEL,
  phone: process.env.NEXT_PUBLIC_GOOGLE_ADS_PHONE_CONVERSION_LABEL,
}

export function fireGoogleAdsConversion(
  eventType: GoogleAdsConversionEvent,
  params: GoogleAdsConversionParams = {},
): void {
  if (typeof window === 'undefined') return

  const adsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
  const label = LABEL_ENV_BY_EVENT[eventType]
  if (!adsId || !label) return

  const w = window as GtagWindow
  if (typeof w.gtag !== 'function') return

  const payload: Record<string, unknown> = {
    send_to: `${adsId}/${label}`,
  }
  if (typeof params.value === 'number') payload.value = params.value
  if (params.currency) payload.currency = params.currency
  if (params.transactionId) payload.transaction_id = params.transactionId

  w.gtag('event', 'conversion', payload)
}
