import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createApiReferenceId } from '@/lib/api-response'
import { checkProviderRegistrationProfilePhotoLimit } from '@/lib/rate-limit'
import { uploadProviderProfilePhoto } from '@/lib/storage'
import { timestamp } from '@/lib/support-diagnostics'

const SURFACE = 'provider_registration_profile_photo'
const MAX_FILE_SIZE = 10 * 1024 * 1024

function categoryFor(status: number) {
  if (status === 401) return 'authentication'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'internal'
  return 'validation'
}

function clientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || null
}

function errorResponse(code: string, message: string, status: number) {
  const referenceId = createApiReferenceId()
  return NextResponse.json(
    {
      ok: false,
      code,
      message,
      error: {
        code,
        category: categoryFor(status),
        message,
        reference_id: referenceId,
        referenceId,
        retryable: status === 429 || status >= 500,
        suggested_actions: status === 429
          ? ['Wait before retrying.']
          : status === 401
            ? ['Verify your mobile number and try again.']
            : ['Choose a clear image under 10 MB and try again.'],
        context: { surface: SURFACE },
        timestamp: timestamp(),
      },
    },
    { status },
  )
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.phone) {
    return errorResponse(
      'REGISTRATION_SESSION_REQUIRED',
      'Verify your mobile number before uploading a profile photo.',
      401,
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse('INVALID_PROFILE_PHOTO', 'Please choose an image file.', 422)
  }

  const upload = formData.get('file')
  if (!(upload instanceof File)) {
    return errorResponse('INVALID_PROFILE_PHOTO', 'Please choose an image file.', 422)
  }

  if (!upload.type.startsWith('image/')) {
    return errorResponse('INVALID_PROFILE_PHOTO', 'Please choose an image file.', 422)
  }

  if (upload.size > MAX_FILE_SIZE) {
    return errorResponse('PROFILE_PHOTO_TOO_LARGE', 'Photo is too large. Use an image under 10 MB.', 422)
  }

  const rateLimit = await checkProviderRegistrationProfilePhotoLimit({
    phone: session.phone,
    ip: clientIp(request),
    context: { surface: SURFACE },
  })
  if (!rateLimit.ok) {
    return errorResponse(
      rateLimit.code === 'limiter_unavailable' ? 'PROFILE_PHOTO_UPLOAD_UNAVAILABLE' : 'RATE_LIMITED',
      rateLimit.code === 'limiter_unavailable'
        ? 'Could not upload the photo right now. Please try again.'
        : 'Too many photo uploads. Please wait before trying again.',
      rateLimit.code === 'limiter_unavailable' ? 503 : 429,
    )
  }

  try {
    const profilePhotoUrl = await uploadProviderProfilePhoto(upload)
    return NextResponse.json({ ok: true, profilePhotoUrl })
  } catch {
    return errorResponse('PROFILE_PHOTO_UPLOAD_FAILED', 'Could not upload the photo right now. Please try again.', 500)
  }
}
