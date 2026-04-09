import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {
    provider: { findUnique: vi.fn() },
    match: { findUnique: vi.fn(), update: vi.fn() },
    quote: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('../../lib/whatsapp-bot', () => ({
  sendQuoteToClient: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /api/technician/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects quote submission before an inspection is marked complete', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')

    ;(getSession as any).mockResolvedValue({ id: 'provider-user', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', name: 'Plumber Pro' })
    ;(db.match.findUnique as any).mockResolvedValue({
      id: 'match-1',
      providerId: 'provider-1',
      inspectionNeeded: true,
      status: 'INSPECTION_SCHEDULED',
      jobRequest: {
        customer: { phone: '+27690000000', name: 'Customer' },
      },
    })
    ;(db.quote.findFirst as any).mockResolvedValue(null)

    const { POST } = await import('../../app/api/technician/quotes/route')
    const request = new NextRequest('http://localhost/api/technician/quotes', {
      method: 'POST',
      body: JSON.stringify({
        matchId: 'match-1',
        labourCost: 850,
        description: 'Inspection-based plumbing quote',
        preferredDate: '2026-04-12',
        postInspection: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Complete the inspection before submitting a quote',
    })
    expect(db.quote.create).not.toHaveBeenCalled()
  })

  it('still allows direct quotes for non-inspection jobs', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')

    ;(getSession as any).mockResolvedValue({ id: 'provider-user', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', name: 'Plumber Pro' })
    ;(db.match.findUnique as any).mockResolvedValue({
      id: 'match-1',
      providerId: 'provider-1',
      inspectionNeeded: false,
      status: 'MATCHED',
      jobRequest: {
        customer: { phone: '+27690000000', name: 'Customer' },
      },
    })
    ;(db.quote.findFirst as any).mockResolvedValue(null)
    ;(db.quote.create as any).mockResolvedValue({ id: 'quote-1' })
    ;(db.match.update as any).mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/technician/quotes/route')
    const request = new NextRequest('http://localhost/api/technician/quotes', {
      method: 'POST',
      body: JSON.stringify({
        matchId: 'match-1',
        labourCost: 850,
        description: 'Direct plumbing quote with labour included',
        preferredDate: '2026-04-12',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ quoteId: 'quote-1' })
    expect(db.quote.create).toHaveBeenCalled()
    expect(db.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { status: 'QUOTED' },
    })
  })

  it('requires a preferred job date when submitting a quote', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')

    ;(getSession as any).mockResolvedValue({ id: 'provider-user', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', name: 'Plumber Pro' })

    const { POST } = await import('../../app/api/technician/quotes/route')
    const request = new NextRequest('http://localhost/api/technician/quotes', {
      method: 'POST',
      body: JSON.stringify({
        matchId: 'match-1',
        labourCost: 850,
        description: 'Direct plumbing quote with labour included',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Preferred job date is required' })
  })

  it('allows a revised quote after the customer declined the previous one', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')

    ;(getSession as any).mockResolvedValue({ id: 'provider-user', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', name: 'Plumber Pro' })
    ;(db.match.findUnique as any).mockResolvedValue({
      id: 'match-1',
      providerId: 'provider-1',
      inspectionNeeded: false,
      status: 'QUOTE_DECLINED',
      jobRequest: {
        customer: { phone: '+27690000000', name: 'Customer' },
      },
    })
    ;(db.quote.findFirst as any).mockResolvedValue({
      id: 'quote-old',
      status: 'DECLINED',
      validUntil: new Date('2026-04-10T10:00:00.000Z'),
    })
    ;(db.quote.create as any).mockResolvedValue({ id: 'quote-2' })
    ;(db.match.update as any).mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/technician/quotes/route')
    const request = new NextRequest('http://localhost/api/technician/quotes', {
      method: 'POST',
      body: JSON.stringify({
        matchId: 'match-1',
        labourCost: 950,
        description: 'Revised quote after reassessing materials and labour',
        preferredDate: '2026-04-14',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ quoteId: 'quote-2' })
    expect(db.quote.create).toHaveBeenCalled()
    expect(db.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { status: 'QUOTED' },
    })
  })
})
