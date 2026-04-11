import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findMany:    vi.fn(),
      updateMany:  vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue('wamid.test'),
}))

import { GET } from '@/app/api/cron/session-timeout/route'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-secret'

function makeRequest() {
  return new Request('http://localhost/api/cron/session-timeout', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id:    'conv_1',
    phone: '+27600000001',
    flow:  'job_request',
    data:  { customerName: 'Thabo Nkosi', selectedCategory: 'Plumbing' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  // Default: updateMany claims successfully
  vi.mocked(db.conversation.updateMany).mockResolvedValue({ count: 1 })
  // Default: no customer record (relies on session data name)
  vi.mocked(db.customer.findUnique).mockResolvedValue(null)
})

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('GET /api/cron/session-timeout — auth', () => {
  it('returns 401 without the correct CRON_SECRET', async () => {
    const req = new Request('http://localhost/api/cron/session-timeout', {
      headers: { authorization: 'Bearer wrong' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(wa.sendText).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET env var is unset (bypass prevention)', async () => {
    const original = process.env.CRON_SECRET
    delete process.env.CRON_SECRET

    // This is the bypass vector: template literal renders undefined as "undefined"
    const req = new Request('http://localhost/api/cron/session-timeout', {
      headers: { authorization: 'Bearer undefined' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(wa.sendText).not.toHaveBeenCalled()

    process.env.CRON_SECRET = original
  })
})

// ─── No expired sessions ──────────────────────────────────────────────────────

describe('GET /api/cron/session-timeout — no candidates', () => {
  it('returns found=0 and sends no messages', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ found: 0, sent: 0, skipped: 0, errors: 0 })
    expect(wa.sendText).not.toHaveBeenCalled()
  })
})

// ─── Single expired session ───────────────────────────────────────────────────

describe('GET /api/cron/session-timeout — single mid-flow session', () => {
  it('sends timeout message and returns sent=1', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([makeConversation()] as never)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toMatchObject({ found: 1, sent: 1, skipped: 0, errors: 0 })
    expect(wa.sendText).toHaveBeenCalledOnce()
  })

  it('message starts with "Hi"', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([makeConversation()] as never)

    await GET(makeRequest())

    const [, message] = vi.mocked(wa.sendText).mock.calls[0]
    expect(message).toMatch(/^Hi /)
  })

  it('uses first name from session data', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([
      makeConversation({ data: { customerName: 'Thabo Nkosi' } }),
    ] as never)

    await GET(makeRequest())

    const [, message] = vi.mocked(wa.sendText).mock.calls[0]
    expect(message).toContain('Hi Thabo,')
  })

  it('falls back to Customer record name when session data has no name', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([
      makeConversation({ data: {} }),
    ] as never)
    vi.mocked(db.customer.findUnique).mockResolvedValue({ name: 'Lindiwe Dube', whatsappServiceOptIn: true } as never)

    await GET(makeRequest())

    const [, message] = vi.mocked(wa.sendText).mock.calls[0]
    expect(message).toContain('Hi Lindiwe,')
  })

  it('falls back to "Hi there" when no name is available', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([
      makeConversation({ data: {} }),
    ] as never)
    vi.mocked(db.customer.findUnique).mockResolvedValue(null)

    await GET(makeRequest())

    const [, message] = vi.mocked(wa.sendText).mock.calls[0]
    expect(message).toContain('Hi there,')
  })

  it('sends message to the correct phone number', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([
      makeConversation({ phone: '+27811234567' }),
    ] as never)

    await GET(makeRequest())

    const [phone] = vi.mocked(wa.sendText).mock.calls[0]
    expect(phone).toBe('+27811234567')
  })
})

// ─── Deduplication ────────────────────────────────────────────────────────────

describe('GET /api/cron/session-timeout — deduplication', () => {
  it('skips a conversation when updateMany returns count=0 (already claimed)', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([makeConversation()] as never)
    // Simulate race condition: another process already set timeoutNotifiedAt
    vi.mocked(db.conversation.updateMany).mockResolvedValue({ count: 0 })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toMatchObject({ sent: 0, skipped: 1 })
    expect(wa.sendText).not.toHaveBeenCalled()
  })

  it('atomically claims using the timeoutNotifiedAt: null filter', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([makeConversation({ id: 'conv_xyz' })] as never)

    await GET(makeRequest())

    expect(db.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'conv_xyz', timeoutNotifiedAt: null }),
      })
    )
  })
})

// ─── Service opt-out ─────────────────────────────────────────────────────────

describe('GET /api/cron/session-timeout — service opt-out', () => {
  it('does not send to a customer with whatsappServiceOptIn=false', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([makeConversation()] as never)
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      name: 'Opted Out User',
      whatsappServiceOptIn: false,
    } as never)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toMatchObject({ sent: 0, skipped: 1 })
    expect(wa.sendText).not.toHaveBeenCalled()
  })

  it('sends when customer record not found (unknown / pre-registration user)', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([makeConversation()] as never)
    vi.mocked(db.customer.findUnique).mockResolvedValue(null)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.sent).toBe(1)
    expect(wa.sendText).toHaveBeenCalledOnce()
  })
})

// ─── Multiple sessions ────────────────────────────────────────────────────────

describe('GET /api/cron/session-timeout — multiple expired sessions', () => {
  it('processes all sessions independently', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([
      makeConversation({ id: 'conv_1', phone: '+27600000001', data: { customerName: 'Alice' } }),
      makeConversation({ id: 'conv_2', phone: '+27600000002', data: { customerName: 'Bob' } }),
      makeConversation({ id: 'conv_3', phone: '+27600000003', data: { customerName: 'Carol' } }),
    ] as never)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toMatchObject({ found: 3, sent: 3, skipped: 0, errors: 0 })
    expect(wa.sendText).toHaveBeenCalledTimes(3)
  })

  it('continues processing remaining sessions if one fails', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([
      makeConversation({ id: 'conv_1', phone: '+27600000001' }),
      makeConversation({ id: 'conv_2', phone: '+27600000002' }),
    ] as never)

    // First conversation: updateMany succeeds but sendText throws
    vi.mocked(db.conversation.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    vi.mocked(wa.sendText)
      .mockRejectedValueOnce(new Error('WhatsApp API error'))
      .mockResolvedValueOnce('wamid.ok')

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toMatchObject({ found: 2, sent: 1, errors: 1 })
  })
})

// ─── registration flow ────────────────────────────────────────────────────────

describe('GET /api/cron/session-timeout — registration flow', () => {
  it('uses name from registration session data', async () => {
    vi.mocked(db.conversation.findMany).mockResolvedValue([
      makeConversation({ flow: 'registration', data: { name: 'Sipho Dlamini' } }),
    ] as never)

    await GET(makeRequest())

    const [, message] = vi.mocked(wa.sendText).mock.calls[0]
    expect(message).toContain('Hi Sipho,')
  })
})
