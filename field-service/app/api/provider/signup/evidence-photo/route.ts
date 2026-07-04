import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { validateProviderResumeToken } from '@/lib/provider-resume-tokens'
import { createApiReferenceId } from '@/lib/api-response'
import { uploadProviderEvidencePhoto } from '@/lib/storage'
import { timestamp } from '@/lib/support-diagnostics'

const SURFACE = 'provider_signup_evidence_photo'
// Keep below Vercel's 4.5 MB body limit; shared with storage.ts 10 MB cap but
// we set a tighter 4 MB limit here so oversized bodies are rejected before
// being buffered to the storage helper.
const MAX_FILE_SIZE = 4 * 1024 * 1024
const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function logEvent(level: 'info' | 'warn', fields: Record<string, unknown>) {
  try {
    console[level](JSON.stringify({ surface: SURFACE, ...fields }))
  } catch {
    // Never block the response.
  }
}

function categoryFor(status: number) {
  if (status === 401) return 'authentication'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'internal'
  return 'validation'
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
        suggested_actions: status === 401
          ? ['Use a valid, unexpired signup link.']
          : ['Choose a clear image under 4 MB and try again.'],
        context: { surface: SURFACE },
        timestamp: timestamp(),
      },
    },
    { status },
  )
}

export async function POST(request: NextRequest) {
  // Token is sent as a header to avoid it appearing in multipart field logs.
  const rawToken = request.headers.get('x-provider-resume-token') ?? ''

  if (!rawToken) {
    logEvent('warn', { event: 'missing_token' })
    return errorResponse('EVIDENCE_PHOTO_AUTH_REQUIRED', 'A valid signup token is required.', 401)
  }

  // Validate token early — before we parse the body. Do NOT consume it;
  // uploads are repeatable; only the final submit consumes the token.
  const validated = await validateProviderResumeToken(db, rawToken)
  if (!validated.ok) {
    logEvent('warn', { event: 'token_invalid', reason: validated.reason })
    return errorResponse(
      'EVIDENCE_PHOTO_AUTH_REQUIRED',
      'Your signup link is invalid or has expired. Please request a new one.',
      401,
    )
  }

  const contentLength = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 64 * 1024) {
    logEvent('warn', { event: 'too_large', contentLength })
    return errorResponse('EVIDENCE_PHOTO_TOO_LARGE', 'Photo is too large. Use an image under 4 MB.', 413)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    logEvent('warn', { event: 'formdata_parse_failed' })
    return errorResponse('INVALID_EVIDENCE_PHOTO', 'Please choose a JPG, PNG, WEBP, or HEIC photo.', 422)
  }

  const upload = formData.get('file')
  if (!(upload instanceof File)) {
    logEvent('warn', { event: 'missing_file' })
    return errorResponse('INVALID_EVIDENCE_PHOTO', 'Please choose a JPG, PNG, WEBP, or HEIC photo.', 422)
  }

  const declaredType = upload.type
  const typeIsUnknown = declaredType === '' || declaredType === 'application/octet-stream'
  const looksLikeImage =
    ACCEPTED_MIME_TYPES.has(declaredType) ||
    (typeIsUnknown && /\.(heic|heif|jpe?g|png|webp)$/i.test(upload.name))
  if (!looksLikeImage) {
    logEvent('warn', { event: 'unsupported_mime', mime: declaredType || '(empty)', sizeBytes: upload.size })
    return errorResponse('EVIDENCE_PHOTO_UNSUPPORTED_TYPE', 'Use a JPG, PNG, WEBP, or HEIC photo.', 415)
  }

  if (upload.size > MAX_FILE_SIZE) {
    logEvent('warn', { event: 'too_large', sizeBytes: upload.size })
    return errorResponse('EVIDENCE_PHOTO_TOO_LARGE', 'Photo is too large. Use an image under 4 MB.', 413)
  }

  try {
    const url = await uploadProviderEvidencePhoto(upload)
    logEvent('info', { event: 'upload_succeeded', mime: declaredType || '(empty)', sizeBytes: upload.size })
    return NextResponse.json({ ok: true, url })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const isValidationError =
      message.startsWith('File type not allowed') ||
      message.startsWith('File extension not allowed') ||
      message.startsWith('File content does not match') ||
      message.startsWith('File too large')
    logEvent('warn', {
      event: isValidationError ? 'validation_rejected' : 'storage_failed',
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
    return errorResponse('EVIDENCE_PHOTO_UPLOAD_FAILED', 'Photo upload failed. Please try again.', 502)
  }
}
