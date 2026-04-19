// ─── WhatsApp media download + Vercel Blob upload ────────────────────────────
// Providers can send images/documents during the registration evidence step.
// Meta requires two hops to retrieve media:
//   1. GET /{media-id} → returns { url, mime_type, file_size }
//   2. GET {url} (with auth header) → raw binary

import { put } from '@vercel/blob'

const API_VERSION = 'v21.0'
const MAX_EVIDENCE_SIZE = 15 * 1024 * 1024 // 15 MB — WhatsApp Cloud API limit

const ALLOWED_EVIDENCE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export async function downloadAndStoreWhatsAppMedia(
  mediaId: string,
  prefix = 'evidence'
): Promise<string> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  if (!accessToken) throw new Error('Missing WHATSAPP_ACCESS_TOKEN')

  // Step 1 — resolve media URL + metadata
  const metaRes = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!metaRes.ok) {
    const err = await metaRes.text()
    throw new Error(`WhatsApp media metadata fetch failed: ${err}`)
  }
  const meta = await metaRes.json() as { url: string; mime_type: string; file_size: number }

  if (!ALLOWED_EVIDENCE_TYPES[meta.mime_type]) {
    throw new Error(`Unsupported media type: ${meta.mime_type}`)
  }
  if (meta.file_size > MAX_EVIDENCE_SIZE) {
    throw new Error(`File too large: ${meta.file_size} bytes`)
  }

  // Step 2 — download binary
  const mediaRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!mediaRes.ok) {
    throw new Error(`WhatsApp media download failed: ${mediaRes.status}`)
  }
  const buffer = await mediaRes.arrayBuffer()

  const ext = ALLOWED_EVIDENCE_TYPES[meta.mime_type]
  const filename = `${prefix}/${Date.now()}-${mediaId.slice(-8)}.${ext}`

  const blob = await put(filename, buffer, {
    access: 'public',
    contentType: meta.mime_type,
  })

  return blob.url
}
