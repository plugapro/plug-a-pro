import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAudit, mockSendText } = vi.hoisted(() => ({
  mockAudit: vi.fn(),
  mockSendText: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/location-audit', () => ({ auditLocationReferenceData: mockAudit }))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendText: mockSendText }))

describe('GET /api/cron/location-audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    delete process.env.ADMIN_WHATSAPP_NUMBER
  })

  it('rejects requests without cron secret', async () => {
    const { GET } = await import('@/app/api/cron/location-audit/route')
    const res = await GET(new Request('http://localhost/api/cron/location-audit'))
    expect(res.status).toBe(401)
  })

  it('returns ok audit payload when location data is healthy', async () => {
    mockAudit.mockResolvedValue({ ok: true, counts: { provinces: 9 }, failures: [] })
    const { GET } = await import('@/app/api/cron/location-audit/route')
    const res = await GET(new Request('http://localhost/api/cron/location-audit', {
      headers: { authorization: 'Bearer cron-secret' },
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('fails and notifies ops when location data is unhealthy', async () => {
    process.env.ADMIN_WHATSAPP_NUMBER = '+27820000000'
    mockAudit.mockResolvedValue({ ok: false, counts: { provinces: 8 }, failures: ['Expected at least 9 active provinces'] })
    const { GET } = await import('@/app/api/cron/location-audit/route')
    const res = await GET(new Request('http://localhost/api/cron/location-audit', {
      headers: { authorization: 'Bearer cron-secret' },
    }))

    expect(res.status).toBe(500)
    expect(mockSendText).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining('Location data audit failed'),
      expect.objectContaining({ templateName: 'ops_location_audit_failed' }),
    )
  })
})
