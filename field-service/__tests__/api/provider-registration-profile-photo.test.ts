import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetSession, mockUploadProviderProfilePhoto } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockUploadProviderProfilePhoto: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/storage', () => ({ uploadProviderProfilePhoto: mockUploadProviderProfilePhoto }))

describe('POST /api/provider/registration/profile-photo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ id: 'registration-user-1', phone: '+27823035070' })
    mockUploadProviderProfilePhoto.mockResolvedValue('https://blob.example/profile-photo.png')
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

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_PROFILE_PHOTO',
      message: 'Please choose an image file.',
    })
    expect(mockUploadProviderProfilePhoto).not.toHaveBeenCalled()
  })
})
