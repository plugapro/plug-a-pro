// Server-side conversion events for Meta Conversions API + GA4 Measurement
// Protocol. Fired from server actions and webhook handlers (quote approval,
// payment success/fail, booking confirmation, job completion) so the funnel
// keeps reporting even when client-side Pixel/gtag are blocked or denied.
//
// Design:
//   - Env-gated: no network call when the relevant credentials are unset
//   - Non-prod gate: only fires when VERCEL_ENV === 'production' so staging
//     and previews don't pollute the ad accounts
//   - Fire-and-forget: failures are logged and swallowed — a tracker outage
//     must never break a payment commit or a quote approval
//   - Dedup: each event carries `eventId(name, entityId)` so a sibling
//     browser-side Pixel event for the same conversion is deduped by Meta
//     (and by GA4 via the same event_id param)
//
// Env vars consumed (production only):
//   META_CAPI_PIXEL_ID
//   META_CAPI_ACCESS_TOKEN
//   META_CAPI_TEST_EVENT_CODE      (optional, for Meta Events Manager testing)
//   GA4_MEASUREMENT_ID
//   GA4_MEASUREMENT_PROTOCOL_SECRET

import { eventId } from './event-id'

export type ServerConversionName =
  | 'quote_approved'
  | 'booking_confirmed'
  | 'payment_success'
  | 'payment_failed'
  | 'job_completed'
  | 'provider_application_submitted'

export interface ServerConversion {
  name: ServerConversionName
  entityId: string
  value?: number
  currency?: string
  customParams?: Record<string, string | number | boolean>
  /**
   * Meta Click-to-WhatsApp click id (referral.ctwa_clid). When present AND
   * META_PAGE_ID is configured, the CAPI event is sent with
   * action_source=business_messaging so Meta can attribute the conversion to
   * the originating ad and optimize delivery on it.
   */
  ctwaClid?: string | null
}

// Read each call to remain testable (vi.stubEnv changes propagate).
function metaConfig() {
  return {
    pixelId: process.env.META_CAPI_PIXEL_ID,
    accessToken: process.env.META_CAPI_ACCESS_TOKEN,
    testEventCode: process.env.META_CAPI_TEST_EVENT_CODE,
  }
}

function ga4Config() {
  return {
    measurementId: process.env.GA4_MEASUREMENT_ID,
    apiSecret: process.env.GA4_MEASUREMENT_PROTOCOL_SECRET,
  }
}

function isProd() {
  return process.env.VERCEL_ENV === 'production'
}

// Map our domain event names to Meta's standard event catalog where one fits
// cleanly; otherwise the platform records them as custom events.
function metaEventNameFor(name: ServerConversionName): string {
  switch (name) {
    case 'payment_success':
      return 'Purchase'
    case 'payment_failed':
      return 'AddPaymentInfo'
    case 'booking_confirmed':
      return 'Schedule'
    case 'quote_approved':
      return 'SubmitApplication'
    case 'job_completed':
      return 'CompleteRegistration'
    case 'provider_application_submitted':
      return 'Lead'
    default:
      return name
  }
}

async function sendToMetaCapi(event: ServerConversion): Promise<void> {
  if (!isProd()) return
  const { pixelId, accessToken, testEventCode } = metaConfig()
  if (!pixelId || !accessToken) return

  const url = `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`
  const customData: Record<string, unknown> = { ...(event.customParams ?? {}) }
  if (event.value !== undefined) {
    customData.value = event.value
    customData.currency = event.currency ?? 'ZAR'
  }
  // CTWA conversions: Meta requires action_source=business_messaging with
  // user_data.ctwa_clid + user_data.page_id for click-to-WhatsApp attribution.
  // Falls back to the standard website shape when META_PAGE_ID is unset.
  const pageId = process.env.META_PAGE_ID
  const isCtwa = Boolean(event.ctwaClid && pageId)
  const body = {
    data: [
      {
        event_name: metaEventNameFor(event.name),
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId(event.name, event.entityId),
        ...(isCtwa
          ? {
              action_source: 'business_messaging',
              messaging_channel: 'whatsapp',
              user_data: { ctwa_clid: event.ctwaClid, page_id: pageId },
            }
          : { action_source: 'website' }),
        ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn('[server-events] meta capi non-2xx', {
        status: res.status,
        event: event.name,
        entityId: event.entityId,
      })
    }
  } catch (err) {
    console.warn('[server-events] meta capi fetch failed', {
      event: event.name,
      entityId: event.entityId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function sendToGa4Mp(event: ServerConversion): Promise<void> {
  if (!isProd()) return
  const { measurementId, apiSecret } = ga4Config()
  if (!measurementId || !apiSecret) return

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`
  // Server events have no GA cid; use a deterministic per-entity client id so
  // GA4 can dedupe replays on the same entity.
  const params: Record<string, unknown> = {
    event_id: eventId(event.name, event.entityId),
    entity_id: event.entityId,
    ...(event.customParams ?? {}),
  }
  if (event.value !== undefined) {
    params.value = event.value
    params.currency = event.currency ?? 'ZAR'
  }
  const body = {
    client_id: `server.${event.entityId}`,
    events: [{ name: event.name, params }],
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn('[server-events] ga4 mp non-2xx', {
        status: res.status,
        event: event.name,
        entityId: event.entityId,
      })
    }
  } catch (err) {
    console.warn('[server-events] ga4 mp fetch failed', {
      event: event.name,
      entityId: event.entityId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Public API — fire-and-forget; never throws into the caller. Caller may
// `void` it or `.catch(() => {})`; both are safe.
export async function emitServerConversion(event: ServerConversion): Promise<void> {
  await Promise.allSettled([sendToMetaCapi(event), sendToGa4Mp(event)])
}
