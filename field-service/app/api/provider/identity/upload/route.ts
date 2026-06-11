import { NextResponse, type NextRequest } from 'next/server'
import { getRequiredDocumentKinds, isIdentityBasis, type IdentityDocumentKind } from '@/lib/identity-verification/types'
import { logIdentityVerificationError, logIdentityVerificationEvent } from '@/lib/identity-verification/log'
import { storeIdentityDocument } from '@/lib/identity-verification/storage'
import { resolveProviderVerificationToken } from '@/lib/provider-verification-token'
import { checkIdentityUploadLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Upper bound for a single multipart upload (one document image). Aligned with
// the storage helper's 10 MB per-file cap plus a small multipart overhead
// margin. Requests larger than this are rejected via Content-Length BEFORE the
// body is parsed, so an unauthenticated attacker cannot force the server to
// buffer huge bodies before token validation (finding 8c2d2393).
const MAX_UPLOAD_BYTES = 11 * 1024 * 1024

export async function POST(request: NextRequest) {
  // Reject oversized bodies up front, before any parsing work.
  const contentLength = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return jsonOrRedirect(request, undefined, { ok: false, error: 'File is too large.' }, 413)
  }

  // The verification token is read from a header/query param FIRST so an invalid
  // or missing token is rejected before request.formData() buffers the body.
  const preflightToken = tokenFromRequest(request)
  let preflightVerification: Awaited<ReturnType<typeof resolveProviderVerificationToken>> | null = null
  if (preflightToken) {
    try {
      preflightVerification = await resolveProviderVerificationToken(preflightToken)
    } catch {
      return jsonOrRedirect(request, undefined, { ok: false, error: 'Verification link is invalid or expired.' }, 401)
    }
  }

  // Rate-limit before parsing the body so repeated large POSTs from one identity
  // cannot consume memory/CPU. Keyed by verification id when we already resolved
  // a token, else by client IP for the still-unauthenticated case.
  const rateLimitKey = preflightVerification?.id ?? `ip:${clientIp(request)}`
  const uploadLimit = await checkIdentityUploadLimit({ identifier: rateLimitKey })
  if (!uploadLimit.ok) {
    return jsonOrRedirect(request, undefined, { ok: false, error: 'Too many uploads. Please wait and try again.' }, 429)
  }

  const formData = await request.formData()
  const token = preflightToken || formData.get('token')?.toString() || ''
  const verificationId = formData.get('verificationId')?.toString() ?? ''
  const documentKind = formData.get('documentKind')?.toString() ?? ''
  const returnTo = formData.get('returnTo')?.toString()
  const file = formData.get('file')

  let verification: Awaited<ReturnType<typeof resolveProviderVerificationToken>>
  try {
    verification = preflightVerification ?? await resolveProviderVerificationToken(token)
  } catch {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Verification link is invalid or expired.' }, 401)
  }

  if (verification.id !== verificationId) {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Verification link is invalid or expired.' }, 403)
  }

  if (!isIdentityDocumentKind(documentKind)) {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Unsupported document type.' }, 400)
  }

  if (!isIdentityBasis(verification.identityBasis)) {
    return jsonOrRedirect(
      request,
      returnTo,
      { ok: false, error: 'Document requirements are unavailable. Please restart this verification step.' },
      400,
    )
  }

  const requiredKinds = getRequiredDocumentKinds(verification.identityBasis)
  if (!requiredKinds.includes(documentKind)) {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'This document is not required for this verification.' }, 400)
  }

  if (!(file instanceof File)) {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Upload a valid file.' }, 400)
  }

  try {
    const document = await storeIdentityDocument({
      verificationId: verification.id,
      documentKind,
      file,
    })

    logIdentityVerificationEvent('upload.stored', {
      verificationId: verification.id,
      providerId: verification.providerId,
      status: verification.status,
      documentKind,
      documentId: document.id,
      sizeBytes: file.size,
      mimeType: file.type,
    })

    return jsonOrRedirect(
      request,
      returnTo,
      { ok: true, documentId: document.id },
      201,
    )
  } catch (error) {
    logIdentityVerificationError('upload.failed', error, {
      verificationId: verification.id,
      providerId: verification.providerId,
      status: verification.status,
      documentKind,
      sizeBytes: file.size,
      mimeType: file.type,
    })
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Could not store this file.' }, 400)
  }
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

function tokenFromRequest(request: NextRequest): string | null {
  // Prefer the header so JS callers keep the token out of the URL (and access logs).
  // Fall back to the ?token= query param for the no-JS multipart upload form in
  // app/provider/verify/[token]/page.tsx, which cannot set request headers. The
  // verification token is short-lived and scoped, so the bounded URL-log exposure
  // on the no-JS path is an accepted trade-off for upload reliability on basic devices.
  const headerToken = request.headers.get('x-provider-verification-token')?.trim()
  if (headerToken) return headerToken
  const queryToken = new URL(request.url).searchParams.get('token')?.trim()
  return queryToken || null
}

function isIdentityDocumentKind(value: string): value is IdentityDocumentKind {
  return [
    'ID_FRONT',
    'ID_BACK',
    'GREEN_ID_BOOK',
    'PASSPORT_PHOTO_PAGE',
    'VISA',
    'WORK_PERMIT',
    'ASYLUM_SEEKER_PERMIT_SECTION_22',
    'REFUGEE_PERMIT_SECTION_24',
    'REFUGEE_ID',
    'SELFIE',
    'LIVENESS_FRAME',
  ].includes(value)
}

function jsonOrRedirect(
  request: NextRequest,
  returnTo: string | undefined,
  body: Record<string, unknown>,
  status: number,
) {
  const wantsHtml = request.headers.get('accept')?.includes('text/html')
  const safeReturnTo = safeProviderVerificationReturnTo(returnTo)
  if (safeReturnTo && wantsHtml) {
    const url = new URL(safeReturnTo, request.url)
    url.searchParams.set(body.ok ? 'uploaded' : 'upload_error', body.ok ? '1' : String(body.error ?? '1'))
    return NextResponse.redirect(url, { status: 303 })
  }
  return NextResponse.json(body, { status })
}

function safeProviderVerificationReturnTo(returnTo: string | undefined): string | null {
  if (!returnTo) return null
  if (!returnTo.startsWith('/provider/verify/')) return null
  if (returnTo.startsWith('//')) return null
  return returnTo
}
