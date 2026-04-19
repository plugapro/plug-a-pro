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
}): Promise<{ attachmentId: string }> {
  const { mediaId, providerApplicationId = null, prefix = 'evidence' } = params

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
    throw new Error(`Unsupported media type: ${meta.mime_type}`)
  }
  if (meta.file_size > MAX_EVIDENCE_SIZE) {
    throw new Error(`File too large: ${meta.file_size} bytes (max ${MAX_EVIDENCE_SIZE})`)
  }

  // Step 2 — download binary
  const mediaRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!mediaRes.ok) {
    throw new Error(`WhatsApp media download failed: ${mediaRes.status}`)
  }
  const buffer = await mediaRes.arrayBuffer()

  // Step 3 — upload to Vercel Blob
  const ext = ALLOWED_EVIDENCE_TYPES[meta.mime_type]
  const pathname = `${prefix}/${mediaId.slice(-8)}.${ext}`

  const blob = await put(pathname, buffer, {
    access: 'public',
    addRandomSuffix: true,       // prevents overwrite collisions on concurrent uploads
    contentType: meta.mime_type,
  })

  // Step 4 — create Attachment record so access goes via the auth proxy.
  // providerApplicationId starts null; backfilled in handlePending once the application row exists.
  const attachment = await db.attachment.create({
    data: {
      providerApplicationId,
      url: blob.url,
      blobKey: blob.pathname,
      mimeType: meta.mime_type,
      sizeBytes: meta.file_size,
      label: 'evidence',
      uploadedBy: 'system:whatsapp',
    },
  })

  return { attachmentId: attachment.id }
}
