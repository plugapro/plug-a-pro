import { describe, expect, it } from 'vitest'
import {
  PROFILE_PHOTO_MAX_BYTES,
  mapUploadStatusToMessage,
} from '@/components/provider/registration/ProviderRegistrationClient'

describe('profile photo client helpers', () => {
  it('caps the client at the Vercel 4.5 MB body envelope', () => {
    // The cap must stay under 4.5 MB so the multipart never hits the platform
    // reject path. If someone bumps Vercel's limit, update this together.
    expect(PROFILE_PHOTO_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024)
    expect(PROFILE_PHOTO_MAX_BYTES).toBeGreaterThanOrEqual(3 * 1024 * 1024)
  })

  it('maps the platform-side 413 to the "too large" message', () => {
    // This is the key regression: an HTML 413 from Vercel previously fell
    // through to the generic "Could not upload the photo right now." string.
    expect(mapUploadStatusToMessage(413)).toMatch(/under 4 MB/i)
  })

  it('maps 415 / 422 to a format-specific hint', () => {
    expect(mapUploadStatusToMessage(415)).toMatch(/JPG|PNG|WEBP|HEIC/)
    expect(mapUploadStatusToMessage(422)).toMatch(/JPG|PNG|WEBP|HEIC/)
  })

  it('maps 401 to a verification prompt instead of an opaque retry', () => {
    expect(mapUploadStatusToMessage(401)).toMatch(/Verify your mobile number/i)
  })

  it('maps 429 to a rate-limit message', () => {
    expect(mapUploadStatusToMessage(429)).toMatch(/Too many uploads/i)
  })

  it('maps 5xx to a service-unavailable retry message', () => {
    expect(mapUploadStatusToMessage(500)).toMatch(/try again/i)
    expect(mapUploadStatusToMessage(502)).toMatch(/try again/i)
    expect(mapUploadStatusToMessage(503)).toMatch(/try again/i)
  })

  it('falls back to a generic retry message for unknown statuses', () => {
    expect(mapUploadStatusToMessage(418)).toBe('Could not upload the photo. Please try again.')
  })
})
