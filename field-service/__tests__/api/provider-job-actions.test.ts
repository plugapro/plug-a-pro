import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findUnique: vi.fn(),
    },
    job: {
      findUnique: vi.fn(),
    },
    attachment: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/jobs', () => ({
  transitionJob: vi.fn(),
  createExtraWork: vi.fn(),
}))

vi.mock('@/lib/storage', () => ({
  uploadJobPhoto: vi.fn(),
}))

describe('provider job action routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sanitizes invalid transition errors in the provider status route', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { transitionJob } = await import('@/lib/jobs')

    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', userId: 'user-1' })
    ;(db.job.findUnique as any).mockResolvedValue({ id: 'job-1', providerId: 'provider-1' })
    ;(transitionJob as any).mockRejectedValue(
      new Error('Invalid job transition: STARTED -> EN_ROUTE'),
    )

    const { POST } = await import('../../app/api/technician/jobs/[id]/status/route')
    const req = new NextRequest('http://localhost/api/technician/jobs/job-1/status', {
      method: 'POST',
      body: JSON.stringify({ toStatus: 'EN_ROUTE' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'job-1' }) })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'This job can no longer move to that step. Refresh the page and try again.',
    })
  })

  it('sanitizes upload internals in the provider photo route', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { uploadJobPhoto } = await import('@/lib/storage')

    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', userId: 'user-1' })
    ;(db.job.findUnique as any).mockResolvedValue({ id: 'job-1', providerId: 'provider-1' })
    ;(uploadJobPhoto as any).mockRejectedValue(new Error('blob put failed: upstream timeout'))

    const formData = new FormData()
    formData.append('file', new File(['image-bytes'], 'photo.png', { type: 'image/png' }))
    formData.append('label', 'before')

    const { POST } = await import('../../app/api/technician/jobs/[id]/photo/route')
    const req = new NextRequest('http://localhost/api/technician/jobs/job-1/photo', {
      method: 'POST',
      body: formData,
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'job-1' }) })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'We could not upload the photo right now. Please try again.',
    })
  })

  it('sanitizes extra-work transition failures in the provider extras route', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { createExtraWork } = await import('@/lib/jobs')

    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', userId: 'user-1' })
    ;(db.job.findUnique as any).mockResolvedValue({
      id: 'job-1',
      providerId: 'provider-1',
      bookingId: 'booking-1',
      booking: {
        match: {
          jobRequest: {
            customer: { name: 'Customer', phone: '+27123456789' },
          },
        },
      },
    })
    ;(createExtraWork as any).mockRejectedValue(
      new Error('Invalid job transition: STARTED -> AWAITING_APPROVAL'),
    )

    const { POST } = await import('../../app/api/technician/jobs/[id]/extras/route')
    const req = new NextRequest('http://localhost/api/technician/jobs/job-1/extras', {
      method: 'POST',
      body: JSON.stringify({ description: 'Extra parts', amountRand: 250 }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'job-1' }) })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'This job can no longer request extra work from its current state. Refresh the page and try again.',
    })
  })
})
