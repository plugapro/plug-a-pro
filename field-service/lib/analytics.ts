// Client-side analytics surface. Each method fans out to gtag (GA4) via the
// shared track() helper. Methods that fire on milestones we never want to
// double-count (quote/slot/booking starts, requestSubmitted) dedup via
// sessionStorage; click counters (whatsappClick/phoneClick) do not — every
// click is a real intent signal worth recording.

type GtagWindow = typeof window & {
  gtag?: (...args: unknown[]) => void
}

function track(eventName: string, params: object = {}): void {
  if (typeof window === 'undefined') return
  const w = window as GtagWindow
  if (typeof w.gtag !== 'function') return
  w.gtag('event', eventName, params)
}

function once(key: string, fn: () => void): void {
  if (typeof window === 'undefined') return
  try {
    if (window.sessionStorage.getItem(key)) return
    window.sessionStorage.setItem(key, '1')
  } catch {
    // sessionStorage can throw in privacy mode — fall through and still fire.
  }
  fn()
}

export interface WhatsAppClickParams {
  source: string
  cta_label: string
}

export interface PhoneClickParams {
  source: string
  cta_label: string
}

export interface QuoteStartedParams {
  service_slug: string
  category: string
  area?: string
}

export interface SlotSelectedParams {
  job_request_id: string
  window_start?: string
  window_end?: string
}

export interface BookingStartedParams {
  // No job_request_id exists yet at booking start — anchor on the per-category
  // draft key so the dedup is honest and the GA4 event isn't polluted with a
  // fake id that can't be joined to downstream slot_selected/request_submitted.
  draft_key: string
}

export interface RequestSubmittedParams {
  job_request_id: string
  category?: string
}

export const analytics = {
  whatsappClick(params: WhatsAppClickParams): void {
    track('whatsapp_click', params)
  },

  phoneClick(params: PhoneClickParams): void {
    track('phone_click', params)
  },

  quoteStarted(params: QuoteStartedParams): void {
    once(`pap_a_qs_${params.service_slug}`, () => track('quote_started', params))
  },

  slotSelected(params: SlotSelectedParams): void {
    once(`pap_a_ss_${params.job_request_id}`, () => track('slot_selected', params))
  },

  bookingStarted(params: BookingStartedParams): void {
    once(`pap_a_bs_${params.draft_key}`, () => track('booking_started', params))
  },

  // Clear the booking_started dedup flag once the draft converts, so a fresh
  // booking in the same category + session counts as a new start. Without this
  // the funnel can show more submissions than starts.
  resetBookingStarted(draftKey: string): void {
    if (typeof window === 'undefined') return
    try {
      window.sessionStorage.removeItem(`pap_a_bs_${draftKey}`)
    } catch {
      // sessionStorage unavailable (privacy mode) — nothing to reset.
    }
  },

  requestSubmitted(params: RequestSubmittedParams): void {
    once(`pap_a_rs_${params.job_request_id}`, () => track('request_submitted', params))
  },
}
