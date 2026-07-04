import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createApiReferenceId } from '@/lib/api-response'
import { checkProviderRegistrationProfilePhotoLimit } from '@/lib/rate-limit'
import { uploadProviderEvidencePhoto } from '@/lib/storage'
import { timestamp } from '@/lib/support-diagnostics'

const SURFACE = 'provider_registration_evidence_photo'
// Each evidence photo capped at 4 MB (same as profile-photo route) to stay
// within Vercel Functions' 4.5 MB request body limit.
const MAX_FILE_SIZE = 4 * 1024 * 1024
const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D+/g, '')
  if (digits.length < 4) return '***'
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`
}

function logUploadEvent(level: 'info' | 'warn', fields: Record<string, unknown>) {
  try {
    console[level](JSON.stringify({ surface: SURFACE, ...fields }))
  } catch {
    // Logging must never block the upload response.
  }
}

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
            : ['Choose a clear image under 4 MB and try again.'],
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
    logUploadEvent('warn', { event: 'session_required' })
    return errorResponse(
      'REGISTRATION_SESSION_REQUIRED',
      'Verify your mobile number before uploading evidence photos.',
      401,
    )
  }

  const maskedPhone = maskPhone(session.phone)

  // Reject oversized bodies via Content-Length BEFORE parsing — mirrors
  // profile-photo route (finding a729cfab).
  const contentLength = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 64 * 1024) {
    logUploadEvent('warn', { event: 'too_large', phone: maskedPhone, contentLength })
    return errorResponse('EVIDENCE_PHOTO_TOO_LARGE', 'Photo is too large. Use an image under 4 MB.', 413)
  }

  // Reuse the profile-photo per-phone rate limiter — evidence photos share the
  // same bucket (12 per phone per hour) because a single session-authed upload
  // surface re-using the same limiter is the simplest safe choice and avoids
  // introducing a new Redis key namespace. If the limits need to diverge in
  // future, add a dedicated 'providerRegistrationEvidencePhotoByPhone' limiter.
  const preParseRateLimit = await checkProviderRegistrationProfilePhotoLimit({
    phone: session.phone,
    ip: clientIp(request),
    context: { surface: SURFACE },
  })
  if (!preParseRateLimit.ok) {
    logUploadEvent('warn', { event: 'rate_limited', phone: maskedPhone, code: preParseRateLimit.code })
    return errorResponse(
      preParseRateLimit.code === 'limiter_unavailable' ? 'EVIDENCE_PHOTO_UPLOAD_UNAVAILABLE' : 'RATE_LIMITED',
      preParseRateLimit.code === 'limiter_unavailable'
        ? 'Photo upload is temporarily unavailable. Please try again.'
        : 'Too many photo uploads. Please wait before trying again.',
      preParseRateLimit.code === 'limiter_unavailable' ? 503 : 429,
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    logUploadEvent('warn', { event: 'formdata_parse_failed', phone: maskedPhone })
    return errorResponse('INVALID_EVIDENCE_PHOTO', 'Please choose a JPG, PNG, WEBP, or HEIC photo.', 422)
  }

  const upload = formData.get('file')
  if (!(upload instanceof File)) {
    logUploadEvent('warn', { event: 'missing_file', phone: maskedPhone })
    return errorResponse('INVALID_EVIDENCE_PHOTO', 'Please choose a JPG, PNG, WEBP, or HEIC photo.', 422)
  }

  // iOS Safari may surface HEIC as '' or 'application/octet-stream' — trust the
  // extension in those cases (same logic as profile-photo route).
  const declaredType = upload.type
  const typeIsUnknown = declaredType === '' || declaredType === 'application/octet-stream'
  const looksLikeImage =
    ACCEPTED_MIME_TYPES.has(declaredType) ||
    (typeIsUnknown && /\.(heic|heif|jpe?g|png|webp)$/i.test(upload.name))
  if (!looksLikeImage) {
    logUploadEvent('warn', {
      event: 'unsupported_mime',
      phone: maskedPhone,
      mime: declaredType || '(empty)',
      sizeBytes: upload.size,
    })
    return errorResponse(
      'EVIDENCE_PHOTO_UNSUPPORTED_TYPE',
      'Use a JPG, PNG, WEBP, or HEIC photo.',
      415,
    )
  }

  if (upload.size > MAX_FILE_SIZE) {
    logUploadEvent('warn', { event: 'too_large', phone: maskedPhone, sizeBytes: upload.size })
    return errorResponse('EVIDENCE_PHOTO_TOO_LARGE', 'Photo is too large. Use an image under 4 MB.', 413)
  }

  try {
    const url = await uploadProviderEvidencePhoto(upload)
    logUploadEvent('info', {
      event: 'upload_succeeded',
      phone: maskedPhone,
      mime: declaredType || '(empty)',
      sizeBytes: upload.size,
    })
    return NextResponse.json({ ok: true, url })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const isValidationError =
      message.startsWith('File type not allowed') ||
      message.startsWith('File extension not allowed') ||
      message.startsWith('File content does not match') ||
      message.startsWith('File too large')
    logUploadEvent('warn', {
      event: isValidationError ? 'validation_rejected' : 'storage_failed',
      phone: maskedPhone,
      mime: declaredType || '(empty)',
      sizeBytes: upload.size,
      reason: isValidationError ? message : 'storage_error',
    })
    if (isValidationError) {
      return errorResponse(
        'EVIDENCE_PHOTO_INVALID_CONTENT',
        'That image looks corrupted or in an unsupported format. Try a JPG or PNG taken with your camera.',
        422,
      )
    }
    return errorResponse(
      'EVIDENCE_PHOTO_UPLOAD_FAILED',
      'Photo upload failed. Please try again.',
      502,
    )
  }
}
