import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetSession, mockUploadProviderProfilePhoto } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockUploadProviderProfilePhoto: vi.fn(),
}))
const { mockCheckProviderRegistrationProfilePhotoLimit } = vi.hoisted(() => ({
  mockCheckProviderRegistrationProfilePhotoLimit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/storage', () => ({ uploadProviderProfilePhoto: mockUploadProviderProfilePhoto }))
vi.mock('@/lib/rate-limit', () => ({
  checkProviderRegistrationProfilePhotoLimit: mockCheckProviderRegistrationProfilePhotoLimit,
}))

describe('POST /api/provider/registration/profile-photo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ id: 'registration-user-1', phone: '+27823035070' })
    mockUploadProviderProfilePhoto.mockResolvedValue('https://blob.example/profile-photo.png')
    mockCheckProviderRegistrationProfilePhotoLimit.mockResolvedValue({ ok: true })
  })

  it('uploads one profile photo for a verified registration phone session', async () => {
    const formData = new FormData()
    formData.set('file', new File(['image-bytes'], 'profile.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      profilePhotoUrl: 'https://blob.example/profile-photo.png',
    })
    expect(mockCheckProviderRegistrationProfilePhotoLimit).toHaveBeenCalledWith({
      phone: '+27823035070',
      ip: null,
      context: { surface: 'provider_registration_profile_photo' },
    })
    expect(mockUploadProviderProfilePhoto).toHaveBeenCalledWith(expect.any(File))
  })

  it('rejects uploads before the phone OTP session is verified', async () => {
    mockGetSession.mockResolvedValue(null)
    const formData = new FormData()
    formData.set('file', new File(['image-bytes'], 'profile.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: false,
      code: 'REGISTRATION_SESSION_REQUIRED',
      message: 'Verify your mobile number before uploading a profile photo.',
    })
    expect(body.error.reference_id).toEqual(expect.any(String))
    expect(mockCheckProviderRegistrationProfilePhotoLimit).not.toHaveBeenCalled()
    expect(mockUploadProviderProfilePhoto).not.toHaveBeenCalled()
  })

  it('rejects non-image uploads before storage is called', async () => {
    const formData = new FormData()
    formData.set('file', new File(['pdf'], 'profile.pdf', { type: 'application/pdf' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'PROFILE_PHOTO_UNSUPPORTED_TYPE',
      message: 'Use a JPG, PNG, WEBP, or HEIC photo.',
    })
    expect(mockCheckProviderRegistrationProfilePhotoLimit).not.toHaveBeenCalled()
    expect(mockUploadProviderProfilePhoto).not.toHaveBeenCalled()
  })

  it('accepts HEIC files coming from iOS Safari', async () => {
    const formData = new FormData()
    formData.set('file', new File(['heic-bytes'], 'IMG_4101.HEIC', { type: 'image/heic' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockUploadProviderProfilePhoto).toHaveBeenCalledTimes(1)
  })

  it('accepts an iOS file whose MIME is empty but whose name has a known image extension', async () => {
    // Empty type happens for HEIC files chosen via the iOS Files picker.
    const formData = new FormData()
    formData.set('file', new File(['bytes'], 'IMG_4101.heic', { type: '' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockUploadProviderProfilePhoto).toHaveBeenCalledTimes(1)
  })

  it('rejects files larger than the 4 MB Vercel function body envelope with a 413', async () => {
    const formData = new FormData()
    const big = new Uint8Array(4 * 1024 * 1024 + 1) // 4 MB + 1 byte
    formData.set('file', new File([big], 'big.jpg', { type: 'image/jpeg' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'PROFILE_PHOTO_TOO_LARGE',
      message: 'Photo is too large. Use an image under 4 MB.',
    })
    expect(mockUploadProviderProfilePhoto).not.toHaveBeenCalled()
  })

  it('surfaces storage validation throws as a 422 with a helpful message, not a generic 500', async () => {
    mockUploadProviderProfilePhoto.mockRejectedValueOnce(
      new Error('File content does not match declared type: image/jpeg'),
    )
    const formData = new FormData()
    formData.set('file', new File(['heic-bytes-pretending-to-be-jpeg'], 'profile.jpg', { type: 'image/jpeg' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'PROFILE_PHOTO_INVALID_CONTENT',
    })
  })

  it('maps an unexpected storage failure to 502 PROFILE_PHOTO_UPLOAD_FAILED', async () => {
    mockUploadProviderProfilePhoto.mockRejectedValueOnce(new Error('blob storage offline'))
    const formData = new FormData()
    formData.set('file', new File(['image-bytes'], 'profile.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'PROFILE_PHOTO_UPLOAD_FAILED',
    })
  })

  it('rate limits repeated profile photo uploads before storage is called', async () => {
    mockCheckProviderRegistrationProfilePhotoLimit.mockResolvedValue({
      ok: false,
      code: 'rate_limited',
      retryAfterMs: 60_000,
    })
    const formData = new FormData()
    formData.set('file', new File(['image-bytes'], 'profile.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/provider/registration/profile-photo/route')
    const response = await POST(new NextRequest('http://localhost/api/provider/registration/profile-photo', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many photo uploads. Please wait before trying again.',
      error: {
        category: 'rate_limit',
        retryable: true,
      },
    })
    expect(mockUploadProviderProfilePhoto).not.toHaveBeenCalled()
  })
})
