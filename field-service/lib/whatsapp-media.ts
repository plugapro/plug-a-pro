// ─── WhatsApp media download + Vercel Blob upload ────────────────────────────
// Providers can send images/documents during the registration evidence step.
// Meta requires two hops to retrieve media:
//   1. GET /{media-id} → returns { url, mime_type, file_size }
//   2. GET {url} (with auth header) → raw binary
//
// Returns an Attachment record ID — callers store the ID, not the blob URL,
// so all access goes through the /api/attachments/[id] auth proxy.
//
// providerApplicationId is nullable: evidence is uploaded before the ProviderApplication
// row is created. handlePending backfills the FK once the application record exists.

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { db } from './db'

const API_VERSION = 'v21.0'
const MAX_EVIDENCE_SIZE = 15 * 1024 * 1024 // 15 MB — WhatsApp Cloud API limit

const ALLOWED_EVIDENCE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export async function downloadAndStoreWhatsAppMedia(params: {
  mediaId: string
  providerApplicationId?: string | null
  prefix?: string
  label?: string
  maxSizeBytes?: number
}): Promise<{ attachmentId: string }> {
  const { mediaId, providerApplicationId = null, prefix = 'evidence', label = 'evidence', maxSizeBytes = MAX_EVIDENCE_SIZE } = params
  const uploadedBy = `system:whatsapp:${mediaId}`
  const traceId = randomUUID().slice(0, 8)

  const existing = await db.attachment.findFirst({
    where: { uploadedBy, label },
    select: { id: true },
  })
  if (existing) {
    console.info('[whatsapp-media] duplicate media delivery reused existing attachment', {
      traceId,
      mediaIdSuffix: mediaId.slice(-8),
      attachmentId: existing.id,
      label,
    })
    return { attachmentId: existing.id }
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  if (!accessToken) throw new Error('Missing WHATSAPP_ACCESS_TOKEN')

  // Step 1 — resolve media URL + metadata
  const metaRes = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!metaRes.ok) {
    const err = await metaRes.text()
    throw new Error(`WhatsApp media metadata fetch failed (${metaRes.status}): ${err}`)
  }
  const meta = await metaRes.json() as { url: string; mime_type: string; file_size: number }

  if (!ALLOWED_EVIDENCE_TYPES[meta.mime_type]) {
    console.warn('[whatsapp-media] rejected unsupported media type', {
      traceId,
      mediaIdSuffix: mediaId.slice(-8),
      mimeType: meta.mime_type,
      label,
    })
    throw new Error(`Unsupported media type: ${meta.mime_type}`)
  }
  if (meta.file_size > maxSizeBytes) {
    console.warn('[whatsapp-media] rejected oversized media', {
      traceId,
      mediaIdSuffix: mediaId.slice(-8),
      sizeBytes: meta.file_size,
      maxSizeBytes,
      label,
    })
    throw new Error(`File too large: ${meta.file_size} bytes (max ${maxSizeBytes})`)
  }
  console.info('[whatsapp-media] metadata resolved', {
    traceId,
    mediaIdSuffix: mediaId.slice(-8),
    mimeType: meta.mime_type,
    sizeBytes: meta.file_size,
    label,
  })

  // Step 2 — download binary
  const mediaRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!mediaRes.ok) {
    throw new Error(`WhatsApp media download failed: ${mediaRes.status}`)
  }
  const buffer = await mediaRes.arrayBuffer()
  if (buffer.byteLength === 0) {
    console.error('[whatsapp-media] downloaded empty media body', {
      traceId,
      mediaIdSuffix: mediaId.slice(-8),
      label,
    })
    throw new Error('WhatsApp media download returned an empty file')
  }

  // Step 3 — upload to Vercel Blob
  const ext = ALLOWED_EVIDENCE_TYPES[meta.mime_type]
  const pathname = `${prefix}/${mediaId.slice(-8)}.${ext}`

  const blob = await put(pathname, buffer, {
    access: 'public',
    addRandomSuffix: true,       // prevents overwrite collisions on concurrent uploads
    contentType: meta.mime_type,
  })
  console.info('[whatsapp-media] media uploaded to app storage', {
    traceId,
    mediaIdSuffix: mediaId.slice(-8),
    blobKey: blob.pathname,
    mimeType: meta.mime_type,
    sizeBytes: buffer.byteLength,
    label,
  })

  // Step 4 — create Attachment record so access goes via the auth proxy.
  // providerApplicationId / jobRequestId start null; backfilled by the caller once the parent
  // record exists (e.g. handlePending for evidence, handleJobRequestSubmitted for customer photos).
  const attachment = await db.attachment.create({
    data: {
      providerApplicationId,
      url: blob.url,
      blobKey: blob.pathname,
      mimeType: meta.mime_type,
      sizeBytes: meta.file_size,
      label,
      uploadedBy,
    },
  })
  console.info('[whatsapp-media] attachment record created', {
    traceId,
    mediaIdSuffix: mediaId.slice(-8),
    attachmentId: attachment.id,
    label,
  })

  return { attachmentId: attachment.id }
}
