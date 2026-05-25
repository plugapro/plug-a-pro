import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockResolveToken, mockStoreIdentityDocument } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockStoreIdentityDocument: vi.fn(),
}))

vi.mock('@/lib/provider-verification-token', () => ({
  resolveProviderVerificationToken: mockResolveToken,
}))

vi.mock('@/lib/identity-verification/storage', () => ({
  storeIdentityDocument: mockStoreIdentityDocument,
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
