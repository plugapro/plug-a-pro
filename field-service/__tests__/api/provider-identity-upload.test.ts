import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockResolveToken,
  mockStoreIdentityDocument,
  mockFindManyDocuments,
  mockSubmitIdentityDocuments,
  mockSubmitIdentitySelfie,
} = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockStoreIdentityDocument: vi.fn(),
  mockFindManyDocuments: vi.fn(),
  mockSubmitIdentityDocuments: vi.fn(),
  mockSubmitIdentitySelfie: vi.fn(),
}))

vi.mock('@/lib/provider-verification-token', () => ({
  resolveProviderVerificationToken: mockResolveToken,
}))

vi.mock('@/lib/identity-verification/storage', () => ({
  storeIdentityDocument: mockStoreIdentityDocument,
}))

vi.mock('@/lib/db', () => ({
  db: {
    providerIdentityDocument: { findMany: mockFindManyDocuments },
  },
}))

vi.mock('@/app/provider/verify/[token]/actions', () => ({
  submitIdentityDocuments: mockSubmitIdentityDocuments,
  submitIdentitySelfie: mockSubmitIdentitySelfie,
}))

describe('POST /api/provider/identity/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      identityBasis: 'SA_ID',
      status: 'AWAITING_DOCUMENT',
    })
    mockStoreIdentityDocument.mockResolvedValue({ id: 'doc-1', documentKind: 'ID_FRONT' })
    mockFindManyDocuments.mockResolvedValue([])
    mockSubmitIdentityDocuments.mockResolvedValue({ ok: true })
    mockSubmitIdentitySelfie.mockResolvedValue({ ok: true })
  })

  it('stores a required identity document through private identity storage', async () => {
    const form = new FormData()
    form.set('token', 'token-1')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'ID_FRONT')
    form.set('file', new File(['%PDF- id'], 'id.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ok: true, documentId: 'doc-1' })
    expect(mockStoreIdentityDocument).toHaveBeenCalledWith({
      verificationId: 'ver-1',
      documentKind: 'ID_FRONT',
      file: expect.any(File),
    })
  })

  it('rejects document kinds that are not required for the selected basis', async () => {
    const form = new FormData()
    form.set('token', 'token-1')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'WORK_PERMIT')
    form.set('file', new File(['%PDF- permit'], 'permit.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(400)
    expect(mockStoreIdentityDocument).not.toHaveBeenCalled()
  })

  it('returns a controlled error when document requirements cannot be resolved', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      identityBasis: 'NOT_A_REAL_BASIS',
      status: 'AWAITING_DOCUMENT',
    })
    const form = new FormData()
    form.set('token', 'token-1')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'ID_FRONT')
    form.set('file', new File(['%PDF- id'], 'id.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Document requirements are unavailable'),
    })
    expect(mockStoreIdentityDocument).not.toHaveBeenCalled()
  })

  it('returns a neutral unauthorized response for invalid tokens', async () => {
    mockResolveToken.mockRejectedValue(new Error('invalid token'))
    const form = new FormData()
    form.set('token', 'bad-token')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'ID_FRONT')
    form.set('file', new File(['%PDF- id'], 'id.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(401)
    expect(mockStoreIdentityDocument).not.toHaveBeenCalled()
  })

  it('rejects invalid query tokens before parsing multipart upload bodies', async () => {
    mockResolveToken.mockRejectedValue(new Error('invalid token'))
    const formData = vi.fn()

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST({
      formData,
      headers: new Headers(),
      url: 'http://localhost/api/provider/identity/upload?token=bad-token',
    } as unknown as NextRequest)

    expect(response.status).toBe(401)
    expect(formData).not.toHaveBeenCalled()
    expect(mockResolveToken).toHaveBeenCalledWith('bad-token')
    expect(mockStoreIdentityDocument).not.toHaveBeenCalled()
  })

  it('auto-advances the verification when the upload completes the document step', async () => {
    // SA_ID document step requires only ID_FRONT. With ID_FRONT now persisted,
    // the step is complete and the route should transition AWAITING_DOCUMENT ->
    // AWAITING_SELFIE so the page renders the next step on reload.
    mockFindManyDocuments.mockResolvedValue([{ documentKind: 'ID_FRONT' }])

    const form = new FormData()
    form.set('token', 'token-1')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'ID_FRONT')
    form.set('file', new File(['%PDF- id'], 'id.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(201)
    expect(mockSubmitIdentityDocuments).toHaveBeenCalledWith('token-1')
    expect(mockSubmitIdentitySelfie).not.toHaveBeenCalled()
  })

  it('auto-advances the verification when the selfie completes the selfie step', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      identityBasis: 'SA_ID',
      status: 'AWAITING_SELFIE',
    })
    mockStoreIdentityDocument.mockResolvedValue({ id: 'doc-2', documentKind: 'SELFIE' })
    mockFindManyDocuments.mockResolvedValue([{ documentKind: 'ID_FRONT' }, { documentKind: 'SELFIE' }])

    const form = new FormData()
    form.set('token', 'token-1')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'SELFIE')
    form.set('file', new File(['selfie bytes'], 'selfie.jpg', { type: 'image/jpeg' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(201)
    expect(mockSubmitIdentitySelfie).toHaveBeenCalledWith('token-1')
    expect(mockSubmitIdentityDocuments).not.toHaveBeenCalled()
  })

  it('does not auto-advance when more documents are still required for the step', async () => {
    // WORK_PERMIT requires PASSPORT_PHOTO_PAGE + WORK_PERMIT before the doc
    // step is complete. Uploading just the passport page should not transition.
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      identityBasis: 'WORK_PERMIT',
      status: 'AWAITING_DOCUMENT',
    })
    mockStoreIdentityDocument.mockResolvedValue({ id: 'doc-1', documentKind: 'PASSPORT_PHOTO_PAGE' })
    mockFindManyDocuments.mockResolvedValue([{ documentKind: 'PASSPORT_PHOTO_PAGE' }])

    const form = new FormData()
    form.set('token', 'token-1')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'PASSPORT_PHOTO_PAGE')
    form.set('file', new File(['%PDF- passport'], 'passport.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(201)
    expect(mockSubmitIdentityDocuments).not.toHaveBeenCalled()
    expect(mockSubmitIdentitySelfie).not.toHaveBeenCalled()
  })

  it('still returns 201 when auto-advance fails so the manual Continue button stays available', async () => {
    mockFindManyDocuments.mockResolvedValue([{ documentKind: 'ID_FRONT' }])
    mockSubmitIdentityDocuments.mockRejectedValue(new Error('transition blocked'))

    const form = new FormData()
    form.set('token', 'token-1')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'ID_FRONT')
    form.set('file', new File(['%PDF- id'], 'id.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ok: true, documentId: 'doc-1' })
  })

  it('does not redirect uploads to an external returnTo target', async () => {
    const form = new FormData()
    form.set('token', 'token-1')
    form.set('verificationId', 'ver-1')
    form.set('documentKind', 'ID_FRONT')
    form.set('returnTo', 'https://example.test/phishing')
    form.set('file', new File(['%PDF- id'], 'id.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/identity/upload/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/identity/upload', {
      method: 'POST',
      body: form,
      headers: { accept: 'text/html' },
    }))

    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBeNull()
    await expect(response.json()).resolves.toEqual({ ok: true, documentId: 'doc-1' })
  })
})
