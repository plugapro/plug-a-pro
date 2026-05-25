import { NextResponse, type NextRequest } from 'next/server'
import { getRequiredDocumentKinds, type IdentityDocumentKind } from '@/lib/identity-verification/types'
import { storeIdentityDocument } from '@/lib/identity-verification/storage'
import { resolveProviderVerificationToken } from '@/lib/provider-verification-token'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const token = formData.get('token')?.toString() ?? ''
  const verificationId = formData.get('verificationId')?.toString() ?? ''
  const documentKind = formData.get('documentKind')?.toString() ?? ''
  const returnTo = formData.get('returnTo')?.toString()
  const file = formData.get('file')

  let verification: Awaited<ReturnType<typeof resolveProviderVerificationToken>>
  try {
    verification = await resolveProviderVerificationToken(token)
  } catch {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Verification link is invalid or expired.' }, 401)
  }

  if (verification.id !== verificationId) {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Verification link is invalid or expired.' }, 403)
  }

  if (!isIdentityDocumentKind(documentKind)) {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Unsupported document type.' }, 400)
  }

  const requiredKinds = getRequiredDocumentKinds(verification.identityBasis as Parameters<typeof getRequiredDocumentKinds>[0])
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

    return jsonOrRedirect(
      request,
      returnTo,
      { ok: true, documentId: document.id },
      201,
    )
  } catch {
    return jsonOrRedirect(request, returnTo, { ok: false, error: 'Could not store this file.' }, 400)
  }
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
