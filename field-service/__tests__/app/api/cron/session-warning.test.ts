import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customer: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags')
  return { ...actual, isEnabled: vi.fn().mockResolvedValue(true) }
})

process.env.CRON_SECRET = 'test-secret'

import { GET } from '@/app/api/cron/session-warning/route'
import { db } from '@/lib/db'
import { sendTemplate } from '@/lib/whatsapp'
import { isEnabled } from '@/lib/flags'

const findManyMock = vi.mocked(db.conversation.findMany)
const updateManyMock = vi.mocked(db.conversation.updateMany)
const sendTemplateMock = vi.mocked(sendTemplate)
const isEnabledMock = vi.mocked(isEnabled)

describe('GET /api/cron/session-warning', () => {
  beforeEach(() => {
    findManyMock.mockReset()
    updateManyMock.mockReset()
    updateManyMock.mockResolvedValue({ count: 1 })
    sendTemplateMock.mockClear()
    sendTemplateMock.mockResolvedValue(undefined as unknown as string)
    isEnabledMock.mockResolvedValue(true)
  })

  it('rejects unauthenticated requests', async () => {
    const req = new Request('http://x/api/cron/session-warning')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('sends a template to one mid-flow session about to expire', async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: 'c1',
        phone: '+27820000003',
        flow: 'registration',
        step: 'reg_collect_skills',
        data: { name: 'Lebo' },
      } as unknown as Awaited<ReturnType<typeof db.conversation.findMany>>[number],
    ])

    const req = new Request('http://x/api/cron/session-warning', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(sendTemplateMock).toHaveBeenCalledTimes(1)
    expect(sendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+27820000003',
        template: 'provider_registration_continue',
      }),
    )
  })

  it('skips sessions where the atomic claim race is lost', async () => {
    updateManyMock.mockResolvedValueOnce({ count: 0 })
    findManyMock.mockResolvedValueOnce([
      {
        id: 'c2',
        phone: '+27820000004',
        flow: 'registration',
        step: 'reg_collect_name',
        data: {},
      } as unknown as Awaited<ReturnType<typeof db.conversation.findMany>>[number],
    ])
    const req = new Request('http://x/api/cron/session-warning', {
      headers: { authorization: 'Bearer test-secret' },
    })
    await GET(req)
    expect(sendTemplateMock).not.toHaveBeenCalled()
  })

  it('does nothing when the flag is disabled', async () => {
    isEnabledMock.mockResolvedValueOnce(false)
    const req = new Request('http://x/api/cron/session-warning', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(findManyMock).not.toHaveBeenCalled()
  })
})
