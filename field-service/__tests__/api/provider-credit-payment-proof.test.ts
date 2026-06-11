import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetSession, mockDb, mockUploadProviderPaymentProof, state } = vi.hoisted(() => {
  const state: { intent: any } = {
    intent: null,
  }

  const mockDb = {
    provider: {
      findUnique: vi.fn(),
    },
    paymentIntent: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  }

  return {
    mockGetSession: vi.fn(),
    mockDb,
    mockUploadProviderPaymentProof: vi.fn(),
    state,
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/storage', () => ({ uploadProviderPaymentProof: mockUploadProviderPaymentProof }))

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    providerId: 'provider-1',
    paymentMethod: 'MANUAL_EFT',
    status: 'PENDING_PAYMENT',
    proofOfPaymentUrl: null,
    metadata: {},
    ...overrides,
  }
}

describe('PATCH /api/provider/wallet/top-up-intents/[id]/proof', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.intent = makeIntent()
    mockGetSession.mockResolvedValue({ id: 'user-1', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1' })
    mockDb.paymentIntent.findFirst.mockImplementation(async () => state.intent)
    mockDb.paymentIntent.update.mockImplementation(async (args: any) => {
      state.intent = { ...state.intent, ...args.data }
      return state.intent
    })
    // Atomic, predicate-guarded write: count===1 means the transition applied.
    mockDb.paymentIntent.updateMany.mockImplementation(async (args: any) => {
      state.intent = { ...state.intent, ...args.data }
      return { count: 1 }
    })
    mockUploadProviderPaymentProof.mockResolvedValue('https://store.private.blob.vercel-storage.com/proof.pdf')
  })

  it('uploads proof for the authenticated provider without crediting the wallet', async () => {
    const formData = new FormData()
    formData.set('file', new File(['proof'], 'payment.pdf', { type: 'application/pdf' }))

    const { PATCH } = await import('@/app/api/provider/wallet/top-up-intents/[id]/proof/route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents/intent-1/proof', {
        method: 'PATCH',
        body: formData,
      }),
      { params: Promise.resolve({ id: 'intent-1' }) },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      id: 'intent-1',
      status: 'PROOF_UPLOADED',
      proofUploaded: true,
    })
    expect(body.proofUploadedAt).toEqual(expect.any(String))
    expect(mockDb.paymentIntent.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'intent-1',
        providerId: 'provider-1',
        paymentMethod: 'MANUAL_EFT',
      },
    })
    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'intent-1',
        providerId: 'provider-1',
        paymentMethod: 'MANUAL_EFT',
        status: { in: expect.arrayContaining(['PENDING_PAYMENT', 'PROOF_UPLOADED', 'MATCHED_ON_STATEMENT']) },
        creditedAt: null,
      }),
      data: expect.objectContaining({
        proofOfPaymentUrl: 'https://store.private.blob.vercel-storage.com/proof.pdf',
        status: 'PROOF_UPLOADED',
        metadata: expect.objectContaining({
          proofUploadedAt: expect.any(String),
          proofUploadedByUserId: 'user-1',
        }),
      }),
    }))
  })

  it('rejects non-provider sessions', async () => {
    mockGetSession.mockResolvedValue({ id: 'admin-1', role: 'admin' })
    const formData = new FormData()
    formData.set('file', new File(['proof'], 'payment.pdf', { type: 'application/pdf' }))

    const { PATCH } = await import('@/app/api/provider/wallet/top-up-intents/[id]/proof/route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents/intent-1/proof', {
        method: 'PATCH',
        body: formData,
      }),
      { params: Promise.resolve({ id: 'intent-1' }) },
    )

    expect(response.status).toBe(401)
    expect(mockUploadProviderPaymentProof).not.toHaveBeenCalled()
    expect(mockDb.paymentIntent.update).not.toHaveBeenCalled()
  })

  it('does not allow proof upload for another provider intent', async () => {
    state.intent = null
    const formData = new FormData()
    formData.set('file', new File(['proof'], 'payment.pdf', { type: 'application/pdf' }))

    const { PATCH } = await import('@/app/api/provider/wallet/top-up-intents/[id]/proof/route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents/intent-other/proof', {
        method: 'PATCH',
        body: formData,
      }),
      { params: Promise.resolve({ id: 'intent-other' }) },
    )

    expect(response.status).toBe(404)
    expect(mockUploadProviderPaymentProof).not.toHaveBeenCalled()
    expect(mockDb.paymentIntent.update).not.toHaveBeenCalled()
  })

  it('does not accept proof uploads after the intent is credited', async () => {
    state.intent = makeIntent({ status: 'CREDITED' })
    const formData = new FormData()
    formData.set('file', new File(['proof'], 'payment.pdf', { type: 'application/pdf' }))

    const { PATCH } = await import('@/app/api/provider/wallet/top-up-intents/[id]/proof/route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents/intent-1/proof', {
        method: 'PATCH',
        body: formData,
      }),
      { params: Promise.resolve({ id: 'intent-1' }) },
    )

    expect(response.status).toBe(409)
    expect(mockUploadProviderPaymentProof).not.toHaveBeenCalled()
    expect(mockDb.paymentIntent.update).not.toHaveBeenCalled()
  })
})
