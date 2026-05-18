import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpdateMany, mockFindMany, mockNotifyExpiredJobParties } = vi.hoisted(() => ({
  mockUpdateMany: vi.fn(),
  mockFindMany: vi.fn(),
  mockNotifyExpiredJobParties: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  },
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  notifyExpiredJobParties: mockNotifyExpiredJobParties,
}))

import { GET } from '@/app/api/cron/slots/route'

const CRON_SECRET = 'test-secret'

function makeRequest() {
  return new Request('http://localhost/api/cron/slots', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

describe('GET /api/cron/slots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockNotifyExpiredJobParties.mockResolvedValue({
      customerNotified: true,
      providerNotified: false,
    })
  })

  it('returns 401 without the correct CRON_SECRET', async () => {
    const req = new Request('http://localhost/api/cron/slots', {
      headers: { authorization: 'Bearer wrong' },
    })

    const res = await GET(req)

    expect(res.status).toBe(401)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns expired=0 when no stale open jobs exist', async () => {
    mockFindMany.mockResolvedValue([])

    const res = await GET(makeRequest())

    await expect(res.json()).resolves.toMatchObject({ expired: 0 })
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockNotifyExpiredJobParties).not.toHaveBeenCalled()
  })

  it('expires stale jobs and notifies their parties', async () => {
    mockFindMany.mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }])
    mockUpdateMany.mockResolvedValue({ count: 2 })

    const res = await GET(makeRequest())

    await expect(res.json()).resolves.toMatchObject({ expired: 2 })
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['job-1', 'job-2'] } },
      data: { status: 'EXPIRED' },
    })
    expect(mockNotifyExpiredJobParties).toHaveBeenCalledTimes(2)
    expect(mockNotifyExpiredJobParties).toHaveBeenNthCalledWith(1, { jobRequestId: 'job-1' })
    expect(mockNotifyExpiredJobParties).toHaveBeenNthCalledWith(2, { jobRequestId: 'job-2' })
  })
})
