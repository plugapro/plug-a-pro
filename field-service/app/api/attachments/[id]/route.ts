// GET /api/attachments/[id]
// Authenticated proxy for job attachments.
// New uploads default to private blob access, while legacy public blobs may
// still exist. This route acts as the only supported retrieval path so that
// attachment access remains tied to a verified session.
//
// Access rules:
//   - admin: can access any attachment
//   - provider: can access attachments for jobs they own
//   - customer: can access attachments on their own job requests / jobs

import { type NextRequest, NextResponse } from 'next/server'
import { head } from '@vercel/blob'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { resolveJobRequestAccessScope } from '@/lib/job-request-access'
import { resolveProviderLeadAttachmentScope } from '@/lib/provider-lead-access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = crypto.randomUUID().slice(0, 8)
  const token = request.nextUrl.searchParams.get('token')?.trim() || null
  const leadToken = request.nextUrl.searchParams.get('leadToken')?.trim() || null

  const session = await getSession()

  const { id } = await params

  const attachment = await db.attachment.findUnique({
    where: { id },
    include: {
      job: {
        select: {
          providerId: true,
          booking: {
            select: {
              match: {
                select: {
                  jobRequest: {
                    select: {
                      id: true,
                      customer: { select: { id: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      jobRequest: {
        select: {
          id: true,
          customer: { select: { id: true } },
        },
      },
    },
  })

  if (!attachment) {
    console.warn(`[attachments:${reqId}] Not found: ${id}`)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const tokenScope = token ? await resolveJobRequestAccessScope(token) : null
  const leadTokenScope = leadToken ? await resolveProviderLeadAttachmentScope(leadToken) : null
  const attachmentJobRequestId =
    attachment.jobRequest?.id ??
    attachment.job?.booking?.match?.jobRequest?.id ??
    null
  const tokenAllowsAttachment =
    tokenScope?.status === 'active' &&
    attachmentJobRequestId != null &&
    tokenScope.jobRequestId === attachmentJobRequestId
  const leadTokenAllowsAttachment =
    leadTokenScope?.status === 'active' &&
    attachmentJobRequestId != null &&
    leadTokenScope.jobRequestId === attachmentJobRequestId

  let sessionAllowsAttachment = false

  if (session?.role === 'admin') {
    sessionAllowsAttachment = true
  } else if (session) {
    // For provider role we need the Provider.id (DB row) to compare against job.providerId.
    // session.id is the Supabase userId, not the Provider PK.
    let providerDbId: string | null = null
    if (session.role === 'provider') {
      const providerRecord = await db.provider.findUnique({
        where: { userId: session.id },
        select: { id: true },
      })
      providerDbId = providerRecord?.id ?? null
    }
    const customerRecord =
      session.role === 'customer'
        ? await resolveCustomerForSession(db, session)
        : null

    const allowed = (() => {
      if (session.role === 'provider') {
        return providerDbId != null && attachment.job?.providerId === providerDbId
      }
      if (session.role === 'customer') {
        const customerViaJob =
          attachment.job?.booking?.match?.jobRequest?.customer?.id === customerRecord?.id
        const customerViaRequest = attachment.jobRequest?.customer?.id === customerRecord?.id
        return customerViaJob || customerViaRequest
      }
      return false
    })()

    if (!allowed) {
      console.warn(`[attachments:${reqId}] Forbidden: user=${session.id} role=${session.role} attachment=${id}`)
    }

    sessionAllowsAttachment = allowed
  }

  if (!sessionAllowsAttachment && !tokenAllowsAttachment && !leadTokenAllowsAttachment) {
    if (!session && leadTokenScope?.status) {
      const error = leadTokenScope.status === 'active' ? 'Forbidden' : 'Invalid or expired lead token'
      const status = leadTokenScope.status === 'active' ? 403 : 401
      console.warn(
        `[attachments:${reqId}] Lead token denied: tokenStatus=${leadTokenScope.status} attachment=${id} jobRequest=${attachmentJobRequestId ?? 'none'}`,
      )
      return NextResponse.json({ error }, { status })
    }

    if (!session && tokenScope?.status) {
      const error = tokenScope.status === 'active' ? 'Forbidden' : 'Invalid or expired ticket token'
      const status = tokenScope.status === 'active' ? 403 : 401
      console.warn(
        `[attachments:${reqId}] Token denied: tokenStatus=${tokenScope.status} attachment=${id} jobRequest=${attachmentJobRequestId ?? 'none'}`,
      )
      return NextResponse.json({ error }, { status })
    }

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Resolve a server-side download URL first so private blobs stay opaque to clients.
  let upstreamUrl = attachment.url
  try {
    const blob = await head(attachment.url)
    upstreamUrl = blob.downloadUrl
  } catch (err) {
    console.warn(`[attachments:${reqId}] Metadata lookup fallback for ${id}:`, err)
  }

  // Proxy the blob — fetch server-side and stream to client
  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl)
  } catch (err) {
    console.error(`[attachments:${reqId}] Fetch error for ${id}:`, err)
    return NextResponse.json({ error: 'Could not retrieve file' }, { status: 502 })
  }

  if (!upstream.ok) {
    console.error(`[attachments:${reqId}] Blob not found for ${id}: ${upstream.status}`)
    return NextResponse.json({ error: 'File not found in storage' }, { status: 404 })
  }

  const servedTo = session?.id ??
    (leadTokenScope?.jobRequestId ? `lead-token:${leadTokenScope.leadId ?? 'unknown'}` : `ticket-token:${tokenScope?.jobRequestId ?? 'unknown'}`)
  console.info(`[attachments:${reqId}] Served ${id} to ${servedTo}`)

  const headers = new Headers()
  headers.set('Content-Type', attachment.mimeType)
  headers.set('Cache-Control', 'private, max-age=300')
  const disposition = attachment.mimeType.startsWith('image/') ? 'inline' : 'attachment'
  const filename = attachment.blobKey.split('/').pop() ?? 'file'
  headers.set('Content-Disposition', `${disposition}; filename="${filename}"`)

  return new Response(upstream.body, { status: 200, headers })
}
