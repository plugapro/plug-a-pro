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
import { getAdminActor, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { resolveJobRequestAccessScope } from '@/lib/job-request-access'
import { resolveProviderLeadAttachmentScope } from '@/lib/provider-lead-access'
import { verifyCustomerProviderHandoverToken } from '@/lib/customer-provider-handover-access'

type ImageErrorCode =
  | 'ATTACHMENT_RECORD_MISSING'
  | 'IMAGE_STORAGE_PATH_MISSING'
  | 'IMAGE_SIGNED_URL_FAILED'
  | 'IMAGE_NOT_FOUND'
  | 'IMAGE_STORAGE_HOST_BLOCKED'
  | 'IMAGE_TOO_LARGE'

const MAX_PROXY_BYTES = 15 * 1024 * 1024

function isAllowedBlobHost(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname.endsWith('.vercel-storage.com')
}

function safeAttachmentFilename(blobKey: string | null | undefined): string {
  const raw = blobKey?.split('/').pop() || 'file'
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file'
}

function attachmentError({
  code,
  message,
  status,
  reqId,
  attachmentId,
}: {
  code: ImageErrorCode
  message: string
  status: number
  reqId: string
  attachmentId: string
}) {
  return NextResponse.json(
    {
      error: message,
      code,
      attachmentId,
      traceId: reqId,
    },
    {
      status,
      headers: { 'X-Trace-Id': reqId },
    },
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = crypto.randomUUID().slice(0, 8)
  const token = request.nextUrl.searchParams.get('token')?.trim() || null
  const leadToken = request.nextUrl.searchParams.get('leadToken')?.trim() || null
  const handoverToken = request.nextUrl.searchParams.get('handoverToken')?.trim() || null

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
    return attachmentError({
      code: 'ATTACHMENT_RECORD_MISSING',
      message: 'Attachment record was not found',
      status: 404,
      reqId,
      attachmentId: id,
    })
  }

  const tokenScope = token ? await resolveJobRequestAccessScope(token) : null
  const leadTokenScope = leadToken ? await resolveProviderLeadAttachmentScope(leadToken) : null

  // Resolve handover token scope: validates the HMAC-signed token and extracts the jobRequestId
  const handoverTokenPayload = handoverToken
    ? verifyCustomerProviderHandoverToken(handoverToken)
    : null
  const handoverTokenJobRequestId =
    handoverTokenPayload?.status === 'active' && handoverTokenPayload.payload
      ? handoverTokenPayload.payload.jobRequestId
      : null

  const attachmentJobRequestId =
    attachment.jobRequest?.id ??
    attachment.job?.booking?.match?.jobRequest?.id ??
    null
  // Ticket tokens (customer access links) may only serve request-level attachments
  // that are flagged safe for preview. Work-evidence photos (attached to a Job, not a
  // JobRequest) are always accessible after acceptance - the job-attachment path is used
  // for those. This blocks a direct-fetch of a safeForPreview=false attachment even when
  // the caller holds a valid ticket token.
  const isJobAttachment = attachment?.job != null
  const tokenAllowsAttachment =
    tokenScope?.status === 'active' &&
    attachmentJobRequestId != null &&
    tokenScope.jobRequestId === attachmentJobRequestId &&
    (isJobAttachment || attachment?.safeForPreview !== false)
  // Lead tokens (provider signed links) may only serve safeForPreview attachments
  // until the provider has an accepted unlock. After acceptance the full
  // request-level attachment set is allowed, as is any job-level work evidence.
  const leadTokenIsAccepted = (leadTokenScope as { isAccepted?: boolean } | null)?.isAccepted === true
  const leadTokenAllowsAttachment =
    leadTokenScope?.status === 'active' &&
    attachmentJobRequestId != null &&
    leadTokenScope.jobRequestId === attachmentJobRequestId &&
    (isJobAttachment || leadTokenIsAccepted || attachment?.safeForPreview !== false)

  // Handover tokens (customer-facing provider handover links) allow access to
  // request-level attachments scoped to the same jobRequest. Job-level attachments
  // (work evidence) are not served via handover tokens.
  const handoverTokenAllowsAttachment =
    handoverTokenPayload?.status === 'active' &&
    handoverTokenJobRequestId != null &&
    attachmentJobRequestId != null &&
    handoverTokenJobRequestId === attachmentJobRequestId &&
    !isJobAttachment

  let sessionAllowsAttachment = false

  const adminActor = session ? await getAdminActor() : null
  if (adminActor) {
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

    if (
      !allowed &&
      session.role === 'provider' &&
      providerDbId != null &&
      attachmentJobRequestId != null
    ) {
      const scopedLead = await db.lead.findUnique({
        where: {
          jobRequestId_providerId: {
            jobRequestId: attachmentJobRequestId,
            providerId: providerDbId,
          },
        },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          jobRequest: {
            select: {
              match: { select: { status: true } },
            },
          },
        },
      })
      sessionAllowsAttachment = Boolean(
        scopedLead &&
        scopedLead.status !== 'DECLINED' &&
        scopedLead.jobRequest?.match?.status !== 'CANCELLED' &&
        (!scopedLead.expiresAt || scopedLead.expiresAt > new Date()),
      )
    }

    if (!allowed && !sessionAllowsAttachment) {
      console.warn(`[attachments:${reqId}] Forbidden: user=${session.id} role=${session.role} attachment=${id}`)
    }

    sessionAllowsAttachment = sessionAllowsAttachment || allowed
  }

  if (!sessionAllowsAttachment && !tokenAllowsAttachment && !leadTokenAllowsAttachment && !handoverTokenAllowsAttachment) {
    if (!session && leadTokenScope?.status) {
      const error = leadTokenScope.status === 'active' ? 'Forbidden' : 'Invalid or expired lead token'
      const status = leadTokenScope.status === 'active' ? 403 : 401
      const leadTraceId = (leadTokenScope as { traceId?: string }).traceId ?? reqId
      console.warn(
        `[attachments:${reqId}] Lead token denied: tokenStatus=${leadTokenScope.status} attachment=${id} jobRequest=${attachmentJobRequestId ?? 'none'} tokenJobRequest=${leadTokenScope.jobRequestId ?? 'none'} leadTraceId=${leadTraceId}`,
      )
      return NextResponse.json(
        { error, traceId: leadTraceId },
        { status, headers: { 'X-Trace-Id': leadTraceId } },
      )
    }

    if (!session && tokenScope?.status) {
      const error = tokenScope.status === 'active' ? 'Forbidden' : 'Invalid or expired ticket token'
      const status = tokenScope.status === 'active' ? 403 : 401
      console.warn(
        `[attachments:${reqId}] Token denied: tokenStatus=${tokenScope.status} attachment=${id} jobRequest=${attachmentJobRequestId ?? 'none'}`,
      )
      return NextResponse.json(
        { error, traceId: reqId },
        { status, headers: { 'X-Trace-Id': reqId } },
      )
    }

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized', traceId: reqId }, { status: 401, headers: { 'X-Trace-Id': reqId } })
    }

    return NextResponse.json({ error: 'Forbidden', traceId: reqId }, { status: 403, headers: { 'X-Trace-Id': reqId } })
  }

  // Resolve a server-side download URL first so private blobs stay opaque to clients.
  let upstreamUrl = attachment.url
  if (!upstreamUrl) {
    console.error(`[attachments:${reqId}] Missing storage URL for ${id}`)
    return attachmentError({
      code: 'IMAGE_STORAGE_PATH_MISSING',
      message: 'Attachment storage path is missing',
      status: 500,
      reqId,
      attachmentId: id,
    })
  }

  try {
    const blob = await head(attachment.url)
    const downloadUrl = (blob as { downloadUrl?: string | null }).downloadUrl
    if (downloadUrl) {
      upstreamUrl = downloadUrl
    } else {
      console.warn(`[attachments:${reqId}] Blob metadata for ${id} has no downloadUrl; using stored attachment URL`)
    }
  } catch (err) {
    console.warn(`[attachments:${reqId}] Metadata lookup fallback for ${id}:`, err)
  }

  let parsedUpstreamUrl: URL
  try {
    parsedUpstreamUrl = new URL(upstreamUrl)
  } catch (err) {
    console.error(`[attachments:${reqId}] Invalid storage URL for ${id}:`, err)
    return attachmentError({
      code: 'IMAGE_STORAGE_PATH_MISSING',
      message: 'Attachment storage URL is invalid',
      status: 500,
      reqId,
      attachmentId: id,
    })
  }
  if (!isAllowedBlobHost(parsedUpstreamUrl)) {
    console.error(`[attachments:${reqId}] Blocked non-Blob storage host for ${id}: ${parsedUpstreamUrl.hostname}`)
    return attachmentError({
      code: 'IMAGE_STORAGE_HOST_BLOCKED',
      message: 'Attachment storage host is not allowed',
      status: 502,
      reqId,
      attachmentId: id,
    })
  }

  // Proxy the blob - fetch server-side and stream to client
  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, { redirect: 'manual' })
  } catch (err) {
    console.error(`[attachments:${reqId}] Fetch error for ${id}:`, err)
    return attachmentError({
      code: 'IMAGE_SIGNED_URL_FAILED',
      message: 'Could not retrieve attachment from storage',
      status: 502,
      reqId,
      attachmentId: id,
    })
  }

  if (!upstream.ok) {
    if (upstream.status >= 300 && upstream.status < 400) {
      console.error(`[attachments:${reqId}] Blob redirect rejected for ${id}: ${upstream.status}`)
      return attachmentError({
        code: 'IMAGE_SIGNED_URL_FAILED',
        message: 'Attachment storage redirect was rejected',
        status: 502,
        reqId,
        attachmentId: id,
      })
    }
    console.error(`[attachments:${reqId}] Blob not found for ${id}: ${upstream.status}`)
    return attachmentError({
      code: 'IMAGE_NOT_FOUND',
      message: 'Attachment file was not found in storage',
      status: 404,
      reqId,
      attachmentId: id,
    })
  }
  const upstreamLength = Number.parseInt(upstream.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(upstreamLength) && upstreamLength > MAX_PROXY_BYTES) {
    console.error(`[attachments:${reqId}] Blob too large for proxy ${id}: ${upstreamLength}`)
    return attachmentError({
      code: 'IMAGE_TOO_LARGE',
      message: 'Attachment file is too large',
      status: 413,
      reqId,
      attachmentId: id,
    })
  }
  let proxiedBody: BodyInit | null = upstream.body
  if (upstream.body) {
    const bodyBuffer = await upstream.arrayBuffer()
    if (bodyBuffer.byteLength > MAX_PROXY_BYTES) {
      console.error(`[attachments:${reqId}] Blob too large for proxy ${id}: ${bodyBuffer.byteLength}`)
      return attachmentError({
        code: 'IMAGE_TOO_LARGE',
        message: 'Attachment file is too large',
        status: 413,
        reqId,
        attachmentId: id,
      })
    }
    proxiedBody = bodyBuffer
  }

  const servedTo = session?.id ??
    (leadTokenScope?.jobRequestId ? `lead-token:${leadTokenScope.leadId ?? 'unknown'}` :
     handoverTokenJobRequestId ? `handover-token:${handoverTokenJobRequestId}` :
     `ticket-token:${tokenScope?.jobRequestId ?? 'unknown'}`)
  console.info(`[attachments:${reqId}] Served ${id} to ${servedTo}`)

  const headers = new Headers()
  headers.set('Content-Type', attachment.mimeType)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cache-Control', 'private, max-age=300')
  headers.set('X-Trace-Id', reqId)
  const disposition = attachment.mimeType.startsWith('image/') ? 'inline' : 'attachment'
  const filename = safeAttachmentFilename(attachment.blobKey)
  headers.set('Content-Disposition', `${disposition}; filename="${filename}"`)

  return new Response(proxiedBody, { status: 200, headers })
}
