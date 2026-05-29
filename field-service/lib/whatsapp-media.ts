// ─── WhatsApp media download + Vercel Blob upload ────────────────────────────
// Providers can send images/documents during the registration evidence step.
// Meta requires two hops to retrieve media:
//   1. GET /{media-id} → returns { url, mime_type, file_size }
//   2. GET {url} (with auth header) → raw binary
//
// Returns an Attachment record ID - callers store the ID, not the blob URL,
// so all access goes through the /api/attachments/[id] auth proxy.
//
// providerApplicationId is nullable: evidence is uploaded before the ProviderApplication
// row is created. handlePending backfills the FK once the application record exists.

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { db } from './db'
import {
  IdentityDocumentMediaError,
  safeIdentityDocumentMediaErrorLog,
  safeMediaIdSuffix,
} from './identity-verification/document-media-errors'
import { storeIdentityDocument } from './identity-verification/storage'
import type { IdentityDocumentKind } from './identity-verification/types'

const API_VERSION = 'v21.0'
const MAX_EVIDENCE_SIZE = 15 * 1024 * 1024 // 15 MB - WhatsApp Cloud API limit

const ALLOWED_EVIDENCE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

type WhatsAppMediaDownload = {
  buffer: ArrayBuffer
  ext: string
  meta: { url: string; mime_type: string; file_size: number }
  traceId: string
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

  const { buffer, ext, meta } = await downloadWhatsAppMedia({
    mediaId,
    label,
    maxSizeBytes,
    traceId,
  })

  // Step 3 - upload to Vercel Blob
  // Blobs are stored as public for compatibility with the existing evidence upload
  // architecture. The /api/attachments/[id] auth proxy is the canonical access path;
  // addRandomSuffix ensures direct blob URLs are non-guessable.
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

  // Step 4 - create Attachment record so access goes via the auth proxy.
  // providerApplicationId / jobRequestId start null; backfilled by the caller once the parent
  // record exists (e.g. handlePending for evidence, handleJobRequestSubmitted for customer photos).
  const attachment = await db.attachment.create({
    data: {
      providerApplicationId,
      url: blob.url,
      blobKey: blob.pathname,
      mimeType: meta.mime_type,
      sizeBytes: buffer.byteLength,   // actual transferred bytes - meta.file_size can be stale
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

export async function downloadAndStoreWhatsAppIdentityDocument(params: {
  mediaId: string
  verificationId: string
  documentKind: IdentityDocumentKind
  maxSizeBytes?: number
}): Promise<{ documentId: string }> {
  const { mediaId, verificationId, documentKind, maxSizeBytes = MAX_EVIDENCE_SIZE } = params
  const traceId = randomUUID().slice(0, 8)
  const mediaIdSuffix = safeMediaIdSuffix(mediaId) ?? 'unknown'
  const { buffer, ext, meta } = await downloadWhatsAppMedia({
    mediaId,
    label: `identity:${documentKind}`,
    maxSizeBytes,
    traceId,
  })
  const file = new File(
    [buffer],
    `${documentKind}-${mediaIdSuffix}.${ext}`,
    { type: meta.mime_type },
  )
  console.info('[whatsapp-media] identity document storage starting', {
    traceId,
    verificationId,
    documentKind,
    mediaIdSuffix,
    mimeType: meta.mime_type,
    sizeBytes: buffer.byteLength,
    storageProvider: 'vercel_blob',
    storageBucketName: 'identity',
  })
  const document = await storeIdentityDocument({
    verificationId,
    documentKind,
    file,
  })

  console.info('[whatsapp-media] identity media stored privately', {
    traceId,
    mediaIdSuffix,
    verificationId,
    documentId: document.id,
    documentKind,
    mimeType: meta.mime_type,
    sizeBytes: buffer.byteLength,
  })

  return { documentId: document.id }
}

async function downloadWhatsAppMedia(params: {
  mediaId: string
  label: string
  maxSizeBytes: number
  traceId: string
}): Promise<WhatsAppMediaDownload> {
  const { mediaId, label, maxSizeBytes, traceId } = params
  const mediaIdSuffix = safeMediaIdSuffix(mediaId)
  if (!mediaId) {
    throw new IdentityDocumentMediaError({
      code: 'WHATSAPP_MEDIA_ID_MISSING',
      operation: 'whatsapp_media_id_extract',
      message: 'WhatsApp media ID missing',
    })
  }
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  if (!accessToken) {
    throw new IdentityDocumentMediaError({
      code: 'WHATSAPP_ACCESS_TOKEN_MISSING',
      operation: 'whatsapp_media_metadata_fetch',
      message: 'WhatsApp access token missing',
      mediaIdSuffix,
    })
  }

  // Step 1 - resolve media URL + metadata
  const metaRes = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!metaRes.ok) {
    const error = new IdentityDocumentMediaError({
      code: 'WHATSAPP_MEDIA_METADATA_FETCH_FAILED',
      operation: 'whatsapp_media_metadata_fetch',
      message: `WhatsApp media metadata fetch failed (${metaRes.status})`,
      status: metaRes.status,
      mediaIdSuffix,
    })
    console.warn(
      '[whatsapp-media] metadata fetch failed',
      safeIdentityDocumentMediaErrorLog(error),
    )
    throw error
  }
  const meta = await metaRes.json() as { url: string; mime_type: string; file_size: number }

  if (!ALLOWED_EVIDENCE_TYPES[meta.mime_type]) {
    const error = new IdentityDocumentMediaError({
      code: 'UNSUPPORTED_DOCUMENT_MIME_TYPE',
      operation: 'document_mime_validation',
      message: `Unsupported media type: ${meta.mime_type}`,
      mediaIdSuffix,
      mimeType: meta.mime_type,
    })
    console.warn('[whatsapp-media] rejected unsupported media type', {
      ...safeIdentityDocumentMediaErrorLog(error),
      traceId,
      label,
    })
    throw error
  }
  if (meta.file_size > maxSizeBytes) {
    const error = new IdentityDocumentMediaError({
      code: 'DOCUMENT_FILE_TOO_LARGE',
      operation: 'document_size_validation',
      message: `File too large: ${meta.file_size} bytes (max ${maxSizeBytes})`,
      mediaIdSuffix,
      mimeType: meta.mime_type,
      sizeBytes: meta.file_size,
      maxSizeBytes,
    })
    console.warn('[whatsapp-media] rejected oversized media', {
      ...safeIdentityDocumentMediaErrorLog(error),
      traceId,
      label,
    })
    throw error
  }
  console.info('[whatsapp-media] metadata resolved', {
    traceId,
    mediaIdSuffix,
    mimeType: meta.mime_type,
    sizeBytes: meta.file_size,
    label,
  })

  // Step 2 - download binary
  const mediaRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!mediaRes.ok) {
    const error = new IdentityDocumentMediaError({
      code: 'WHATSAPP_MEDIA_DOWNLOAD_FAILED',
      operation: 'whatsapp_media_download',
      message: `WhatsApp media download failed: ${mediaRes.status}`,
      status: mediaRes.status,
      mediaIdSuffix,
      mimeType: meta.mime_type,
      sizeBytes: meta.file_size,
    })
    console.warn(
      '[whatsapp-media] binary download failed',
      safeIdentityDocumentMediaErrorLog(error),
    )
    throw error
  }
  const buffer = await mediaRes.arrayBuffer()
  if (buffer.byteLength === 0) {
    const error = new IdentityDocumentMediaError({
      code: 'WHATSAPP_MEDIA_DOWNLOAD_FAILED',
      operation: 'whatsapp_media_download',
      message: 'WhatsApp media download returned an empty file',
      status: mediaRes.status,
      mediaIdSuffix,
      mimeType: meta.mime_type,
      sizeBytes: 0,
    })
    console.error('[whatsapp-media] downloaded empty media body', {
      ...safeIdentityDocumentMediaErrorLog(error),
      traceId,
      label,
    })
    throw error
  }
  console.info('[whatsapp-media] binary media downloaded', {
    traceId,
    mediaIdSuffix,
    mimeType: meta.mime_type,
    sizeBytes: buffer.byteLength,
    label,
  })

  return {
    buffer,
    ext: ALLOWED_EVIDENCE_TYPES[meta.mime_type],
    meta,
    traceId,
  }
}
