import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockIsEnabled,
  mockCheckNotifyInterestLimit,
  mockTrustedClientIp,
  mockResolveAreaScope,
  mockAddToServiceAreaWaitlist,
} = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
  mockCheckNotifyInterestLimit: vi.fn(),
  mockTrustedClientIp: vi.fn(),
  mockResolveAreaScope: vi.fn(),
  mockAddToServiceAreaWaitlist: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/rate-limit', () => ({ checkNotifyInterestLimit: mockCheckNotifyInterestLimit }))
vi.mock('@/lib/request-ip', () => ({ trustedClientIp: mockTrustedClientIp }))
vi.mock('@/lib/customer-serviceability', () => ({ resolveAreaScope: mockResolveAreaScope }))
vi.mock('@/lib/service-area-guard', () => ({ addToServiceAreaWaitlist: mockAddToServiceAreaWaitlist }))

import { POST } from '@/app/api/customer/notify-interest/route'

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/customer/notify-interest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_NODE = {
  id: 'node-ballito',
  slug: 'kwazulu_natal__durban__umhlanga__ballito',
  label: 'Ballito',
  nodeType: 'SUBURB' as const,
  provinceKey: 'kwazulu_natal',
  cityKey: 'durban',
  regionKey: 'umhlanga',
}

describe('POST /api/customer/notify-interest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
    mockCheckNotifyInterestLimit.mockResolvedValue({ ok: true })
    mockTrustedClientIp.mockReturnValue('1.2.3.4')
    mockResolveAreaScope.mockResolvedValue({ node: VALID_NODE })
    mockAddToServiceAreaWaitlist.mockResolvedValue(undefined)
  })

  it('returns 404 when the flag is off so old clients no-op', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const res = await POST(makeReq({ phone: '0821234567', category: 'plumbing', area: VALID_NODE.slug }))
    expect(res.status).toBe(404)
    expect(mockAddToServiceAreaWaitlist).not.toHaveBeenCalled()
  })

  it('rejects an invalid phone number with 422', async () => {
    const res = await POST(makeReq({ phone: '12', category: 'plumbing', area: VALID_NODE.slug }))
    expect(res.status).toBe(422)
    expect(mockAddToServiceAreaWaitlist).not.toHaveBeenCalled()
  })

  it('rejects a non-pilot category with 422', async () => {
    const res = await POST(makeReq({ phone: '0821234567', category: 'rocket-science', area: VALID_NODE.slug }))
    expect(res.status).toBe(422)
    expect(mockAddToServiceAreaWaitlist).not.toHaveBeenCalled()
  })

  it('rejects an unresolvable area with 422', async () => {
    mockResolveAreaScope.mockResolvedValue(null)
    const res = await POST(makeReq({ phone: '0821234567', category: 'plumbing', area: 'nowhere' }))
    expect(res.status).toBe(422)
    expect(mockAddToServiceAreaWaitlist).not.toHaveBeenCalled()
  })

  it('returns 429 and does not persist when rate limited', async () => {
    mockCheckNotifyInterestLimit.mockResolvedValue({ ok: false, code: 'ip_limit', retryAfterMs: 60_000 })
    const res = await POST(makeReq({ phone: '0821234567', category: 'plumbing', area: VALID_NODE.slug }))
    expect(res.status).toBe(429)
    expect(mockAddToServiceAreaWaitlist).not.toHaveBeenCalled()
  })

  it('persists demand on the waitlist on the happy path', async () => {
    const res = await POST(makeReq({ phone: '0821234567', category: 'plumbing', area: VALID_NODE.slug }))
    expect(res.status).toBe(200)
    expect(mockCheckNotifyInterestLimit).toHaveBeenCalledWith({ phone: '+27821234567', ip: '1.2.3.4' })
    expect(mockAddToServiceAreaWaitlist).toHaveBeenCalledWith({
      phone: '+27821234567',
      category: 'plumbing',
      suburb: 'Ballito',
      city: 'Durban',
      province: 'Kwazulu Natal',
      source: 'pwa',
    })
  })
})
