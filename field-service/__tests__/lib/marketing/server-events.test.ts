import { afterEach, describe, expect, it, vi } from 'vitest'

import { emitServerConversion } from '@/lib/marketing/server-events'

function stubProd() {
  vi.stubEnv('VERCEL_ENV', 'production')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('emitServerConversion — env gating', () => {
  it('makes no network call when neither Meta nor GA4 env is configured', async () => {
    stubProd()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({ name: 'payment_success', entityId: 'bk_1', value: 100 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips network calls outside production even when all env is set', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('META_CAPI_PIXEL_ID', 'p123')
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 't123')
    vi.stubEnv('GA4_MEASUREMENT_ID', 'g123')
    vi.stubEnv('GA4_MEASUREMENT_PROTOCOL_SECRET', 's123')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({ name: 'payment_success', entityId: 'bk_1', value: 100 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls only Meta CAPI when only Meta env is configured', async () => {
    stubProd()
    vi.stubEnv('META_CAPI_PIXEL_ID', 'p123')
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 't123')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({ name: 'payment_success', entityId: 'bk_1', value: 100 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('graph.facebook.com')
  })

  it('calls only GA4 MP when only GA4 env is configured', async () => {
    stubProd()
    vi.stubEnv('GA4_MEASUREMENT_ID', 'g123')
    vi.stubEnv('GA4_MEASUREMENT_PROTOCOL_SECRET', 's123')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({ name: 'payment_success', entityId: 'bk_1', value: 100 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('google-analytics.com')
  })
})

describe('emitServerConversion — request body shape', () => {
  it('Meta CAPI body uses the mapped standard event name, dedup event_id, value+currency', async () => {
    stubProd()
    vi.stubEnv('META_CAPI_PIXEL_ID', 'p123')
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 't123')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({
      name: 'payment_success',
      entityId: 'bk_42',
      value: 250,
      currency: 'ZAR',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('p123/events')
    expect(String(url)).toContain('access_token=t123')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.data[0]).toMatchObject({
      event_name: 'Purchase',
      event_id: 'payment_success:bk_42',
      action_source: 'website',
    })
    expect(body.data[0].custom_data).toMatchObject({ value: 250, currency: 'ZAR' })
    expect(typeof body.data[0].event_time).toBe('number')
  })

  it('GA4 MP body uses server-prefixed client_id and the same dedup event_id', async () => {
    stubProd()
    vi.stubEnv('GA4_MEASUREMENT_ID', 'G-XYZ')
    vi.stubEnv('GA4_MEASUREMENT_PROTOCOL_SECRET', 's_secret')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({ name: 'payment_success', entityId: 'bk_42', value: 250 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('measurement_id=G-XYZ')
    expect(String(url)).toContain('api_secret=s_secret')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.client_id).toBe('server.bk_42')
    expect(body.events[0].name).toBe('payment_success')
    expect(body.events[0].params).toMatchObject({
      event_id: 'payment_success:bk_42',
      entity_id: 'bk_42',
      value: 250,
      currency: 'ZAR',
    })
  })

  it('defaults currency to ZAR when value is provided without explicit currency', async () => {
    stubProd()
    vi.stubEnv('META_CAPI_PIXEL_ID', 'p123')
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 't123')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({ name: 'payment_success', entityId: 'bk_1', value: 100 })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.data[0].custom_data.currency).toBe('ZAR')
  })

  it('omits custom_data entirely for value-less events (e.g. payment_failed)', async () => {
    stubProd()
    vi.stubEnv('META_CAPI_PIXEL_ID', 'p123')
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 't123')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({ name: 'payment_failed', entityId: 'bk_1' })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.data[0].event_name).toBe('AddPaymentInfo')
    expect(body.data[0].custom_data).toBeUndefined()
  })

  it('forwards customParams into both Meta custom_data and GA4 params', async () => {
    stubProd()
    vi.stubEnv('META_CAPI_PIXEL_ID', 'p123')
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 't123')
    vi.stubEnv('GA4_MEASUREMENT_ID', 'G-X')
    vi.stubEnv('GA4_MEASUREMENT_PROTOCOL_SECRET', 's')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({
      name: 'booking_confirmed',
      entityId: 'bk_99',
      customParams: { service_category: 'electrician', area: 'roodepoort' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const metaCall = fetchMock.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('graph.facebook.com'),
    )!
    const ga4Call = fetchMock.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('google-analytics.com'),
    )!
    const metaBody = JSON.parse(String((metaCall[1] as RequestInit).body))
    const ga4Body = JSON.parse(String((ga4Call[1] as RequestInit).body))
    expect(metaBody.data[0].custom_data).toMatchObject({
      service_category: 'electrician',
      area: 'roodepoort',
    })
    expect(ga4Body.events[0].params).toMatchObject({
      service_category: 'electrician',
      area: 'roodepoort',
    })
  })

  it('includes test_event_code when META_CAPI_TEST_EVENT_CODE is configured', async () => {
    stubProd()
    vi.stubEnv('META_CAPI_PIXEL_ID', 'p123')
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 't123')
    vi.stubEnv('META_CAPI_TEST_EVENT_CODE', 'TEST1234')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitServerConversion({ name: 'payment_success', entityId: 'bk_1', value: 100 })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.test_event_code).toBe('TEST1234')
  })
})

describe('emitServerConversion — failure swallowing', () => {
  it('never throws when fetch rejects', async () => {
    stubProd()
    vi.stubEnv('META_CAPI_PIXEL_ID', 'p123')
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 't123')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      emitServerConversion({ name: 'payment_success', entityId: 'bk_1', value: 100 }),
    ).resolves.not.toThrow()
  })

  it('never throws on a non-2xx response', async () => {
    stubProd()
    vi.stubEnv('GA4_MEASUREMENT_ID', 'g')
    vi.stubEnv('GA4_MEASUREMENT_PROTOCOL_SECRET', 's')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      emitServerConversion({ name: 'payment_success', entityId: 'bk_1', value: 100 }),
    ).resolves.not.toThrow()
  })
})
