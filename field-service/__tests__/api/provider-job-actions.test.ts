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
      count: vi.fn(),
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

  it('allows completion sign-off without forcing optional work photos', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { transitionJob } = await import('@/lib/jobs')

    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', userId: 'user-1' })
    ;(db.job.findUnique as any).mockResolvedValue({ id: 'job-1', providerId: 'provider-1' })
    ;(transitionJob as any).mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/technician/jobs/[id]/status/route')
    const req = new NextRequest('http://localhost/api/technician/jobs/job-1/status', {
      method: 'POST',
      body: JSON.stringify({ toStatus: 'PENDING_COMPLETION_CONFIRMATION' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'job-1' }) })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok' })
    expect(transitionJob).toHaveBeenCalledWith({
      jobId: 'job-1',
      toStatus: 'PENDING_COMPLETION_CONFIRMATION',
      actorId: 'user-1',
      actorRole: 'provider',
      notes: undefined,
    })
  })

  it('returns uploaded attachment payloads for multi-photo evidence uploads', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { uploadJobPhoto } = await import('@/lib/storage')

    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', userId: 'user-1' })
    ;(db.job.findUnique as any).mockResolvedValue({ id: 'job-1', providerId: 'provider-1' })
    ;(uploadJobPhoto as any)
      .mockResolvedValueOnce('https://blob.example/photo-1')
      .mockResolvedValueOnce('https://blob.example/photo-2')
    ;(db.attachment.findFirst as any)
      .mockResolvedValueOnce({ id: 'att-1', caption: 'finished repair', label: 'evidence' })
      .mockResolvedValueOnce({ id: 'att-2', caption: 'finished repair', label: 'evidence' })

    const formData = new FormData()
    formData.append('files', new File(['a'], 'one.png', { type: 'image/png' }))
    formData.append('files', new File(['b'], 'two.png', { type: 'image/png' }))
    formData.append('caption', 'finished repair')

    const { POST } = await import('../../app/api/technician/jobs/[id]/photo/route')
    const req = new NextRequest('http://localhost/api/technician/jobs/job-1/photo', {
      method: 'POST',
      body: formData,
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'job-1' }) })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      attachments: [
        {
          id: 'att-1',
          proxyUrl: '/api/attachments/att-1',
          caption: 'finished repair',
          label: 'evidence',
        },
        {
          id: 'att-2',
          proxyUrl: '/api/attachments/att-2',
          caption: 'finished repair',
          label: 'evidence',
        },
      ],
    })
  })

  it('passes technician notes to transitionJob when provided', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { transitionJob } = await import('@/lib/jobs')

    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', userId: 'user-1' })
    ;(db.job.findUnique as any).mockResolvedValue({ id: 'job-1', providerId: 'provider-1' })
    ;(transitionJob as any).mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/technician/jobs/[id]/status/route')
    const req = new NextRequest('http://localhost/api/technician/jobs/job-1/status', {
      method: 'POST',
      body: JSON.stringify({ toStatus: 'STARTED', notes: 'Replaced valve and tested pressure.' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'job-1' }) })
    expect(res.status).toBe(200)
    expect(transitionJob).toHaveBeenCalledWith({
      jobId: 'job-1',
      toStatus: 'STARTED',
      actorId: 'user-1',
      actorRole: 'provider',
      notes: 'Replaced valve and tested pressure.',
    })
  })

  it('ignores blank and non-string notes in the status route', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { transitionJob } = await import('@/lib/jobs')

    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider' })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'provider-1', userId: 'user-1' })
    ;(db.job.findUnique as any).mockResolvedValue({ id: 'job-1', providerId: 'provider-1' })
    ;(transitionJob as any).mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/technician/jobs/[id]/status/route')
    const req = new NextRequest('http://localhost/api/technician/jobs/job-1/status', {
      method: 'POST',
      body: JSON.stringify({ toStatus: 'ARRIVED', notes: '   ' }),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(req, { params: Promise.resolve({ id: 'job-1' }) })
    expect(transitionJob).toHaveBeenCalledWith(
      expect.objectContaining({ notes: undefined }),
    )
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
