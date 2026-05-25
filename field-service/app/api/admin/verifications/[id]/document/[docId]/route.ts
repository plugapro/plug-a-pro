import { type NextRequest, NextResponse } from 'next/server'
import { requireRoleApi } from '@/lib/auth'
import { db } from '@/lib/db'
import { getIdentityDocument } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const actorOrError = await requireRoleApi(['TRUST'])
  if (actorOrError instanceof Response) return actorOrError
  const actor = actorOrError
  const { id, docId } = await params

  const document = await db.providerIdentityDocument.findFirst({
    where: {
      id: docId,
      verificationId: id,
      deletedAt: null,
    },
    select: {
      id: true,
      verificationId: true,
      blobKey: true,
    },
  })

  if (!document) {
    return NextResponse.json({ error: 'Identity document not found' }, { status: 404 })
  }

  await db.providerSensitiveDataAccessLog.createMany({
    data: [
      {
        verificationId: id,
        documentId: docId,
        actorId: actor.id,
        actorRole: actor.adminRole,
        accessType: 'VIEW_DOC',
        ipAddress: ipAddress(request),
        userAgent: request.headers.get('user-agent'),
      },
      {
        verificationId: id,
        documentId: docId,
        actorId: actor.id,
        actorRole: actor.adminRole,
        accessType: 'SIGNED_URL_ISSUED',
        ipAddress: ipAddress(request),
        userAgent: request.headers.get('user-agent'),
      },
    ],
  })

  try {
    const blob = await getIdentityDocument(document.blobKey)
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'Identity document not found' }, { status: 404 })
    }

    return new NextResponse(blob.stream, {
      headers: {
        'Content-Type': blob.blob.contentType,
        'Content-Length': String(blob.blob.size),
        'Content-Disposition': blob.blob.contentDisposition,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[admin/verifications/document] Failed to fetch identity document:', {
      verificationId: id,
      documentId: docId,
      error,
    })
    return NextResponse.json(
      { error: 'Could not load identity document' },
      { status: 502 },
    )
  }
}

function ipAddress(request: NextRequest) {
  return request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip')
}
