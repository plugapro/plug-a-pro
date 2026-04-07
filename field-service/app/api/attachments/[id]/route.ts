// GET /api/attachments/[id]
// Authenticated proxy for job attachments.
// Vercel Blob stores files with access:'public', so direct blob URLs are
// technically reachable by anyone. This route acts as an auth gate:
// clients should use this endpoint instead of the raw blob URL so that
// access is tied to a verified session.
//
// Access rules:
//   - admin: can access any attachment
//   - provider: can access attachments for jobs they own
//   - customer: can access attachments on their own job requests / jobs

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = crypto.randomUUID().slice(0, 8)

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const attachment = await db.attachment.findUnique({
    where: { id },
    include: {
      job: { select: { providerId: true, booking: { select: { match: { select: { jobRequest: { select: { customerId: true } } } } } } } },
      jobRequest: { select: { customerId: true } },
    },
  })

  if (!attachment) {
    console.warn(`[attachments:${reqId}] Not found: ${id}`)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Access check
  if (session.role !== 'admin') {
    const allowed = (() => {
      if (session.role === 'provider') {
        return attachment.job?.providerId != null && attachment.uploadedBy === session.id
      }
      if (session.role === 'customer') {
        const customerViaJob =
          attachment.job?.booking?.match?.jobRequest?.customerId === session.id
        const customerViaRequest = attachment.jobRequest?.customerId === session.id
        return customerViaJob || customerViaRequest
      }
      return false
    })()

    if (!allowed) {
      console.warn(`[attachments:${reqId}] Forbidden: user=${session.id} role=${session.role} attachment=${id}`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Proxy the blob — fetch server-side and stream to client
  let upstream: Response
  try {
    upstream = await fetch(attachment.url)
  } catch (err) {
    console.error(`[attachments:${reqId}] Fetch error for ${id}:`, err)
    return NextResponse.json({ error: 'Could not retrieve file' }, { status: 502 })
  }

  if (!upstream.ok) {
    console.error(`[attachments:${reqId}] Blob not found for ${id}: ${upstream.status}`)
    return NextResponse.json({ error: 'File not found in storage' }, { status: 404 })
  }

  console.info(`[attachments:${reqId}] Served ${id} to user=${session.id}`)

  const headers = new Headers()
  headers.set('Content-Type', attachment.mimeType)
  headers.set('Cache-Control', 'private, max-age=300')
  const disposition = attachment.mimeType.startsWith('image/') ? 'inline' : 'attachment'
  const filename = attachment.blobKey.split('/').pop() ?? 'file'
  headers.set('Content-Disposition', `${disposition}; filename="${filename}"`)

  return new Response(upstream.body, { status: 200, headers })
}
