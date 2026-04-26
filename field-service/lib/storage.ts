// ─── Vercel Blob — file storage helpers ──────────────────────────────────────
// Used for: job request evidence, completion photos, quote attachments, and avatars.

import { put, del } from '@vercel/blob'
import { db } from './db'

const MAX_PHOTO_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]

// ─── Upload ───────────────────────────────────────────────────────────────────

export async function uploadJobPhoto(params: {
  jobId: string
  file: File
  label?: 'before' | 'after' | 'evidence' | string
  caption?: string | null
  uploadedBy: string
}): Promise<string> {
  validateFile(params.file)

  const ext = params.file.name.split('.').pop() ?? 'jpg'
  const key = `jobs/${params.jobId}/${Date.now()}-${params.label ?? 'photo'}.${ext}`

  const blob = await put(key, params.file, {
    // Current @vercel/blob version in this repo still supports public writes only.
    // We still randomize pathnames and force all reads back through the auth proxy.
    access: 'public',
    addRandomSuffix: true,
    contentType: params.file.type,
  })

  await db.attachment.create({
    data: {
      jobId: params.jobId,
      url: blob.url,
      blobKey: blob.pathname,
      mimeType: params.file.type,
      sizeBytes: params.file.size,
      label: params.label,
      caption: params.caption ?? null,
      uploadedBy: params.uploadedBy,
    },
  })

  return blob.url
}

export async function uploadJobRequestPhoto(params: {
  jobRequestId: string
  file: File
  label?: 'evidence' | string
  caption?: string | null
  uploadedBy: string
}): Promise<string> {
  validateFile(params.file)

  const ext = params.file.name.split('.').pop() ?? 'jpg'
  const key = `job-requests/${params.jobRequestId}/${Date.now()}-${params.label ?? 'evidence'}.${ext}`

  const blob = await put(key, params.file, {
    access: 'public',
    addRandomSuffix: true,
    contentType: params.file.type,
  })

  // Attach photos to the request, not the eventual job, so providers can inspect
  // evidence before they decide whether to quote.
  await db.attachment.create({
    data: {
      jobRequestId: params.jobRequestId,
      url: blob.url,
      blobKey: blob.pathname,
      mimeType: params.file.type,
      sizeBytes: params.file.size,
      label: params.label ?? 'evidence',
      caption: params.caption ?? null,
      uploadedBy: params.uploadedBy,
    },
  })

  return blob.url
}

export async function uploadQuoteAttachment(params: {
  quoteId: string
  file: File
  uploadedBy: string
}): Promise<string> {
  validateFile(params.file)

  const ext = params.file.name.split('.').pop() ?? 'jpg'
  const key = `quotes/${params.quoteId}/${Date.now()}.${ext}`

  const blob = await put(key, params.file, {
    access: 'public',
    addRandomSuffix: true,
    contentType: params.file.type,
  })

  await db.attachment.create({
    data: {
      url: blob.url,
      blobKey: blob.pathname,
      mimeType: params.file.type,
      sizeBytes: params.file.size,
      label: `quote:${params.quoteId}`,
      uploadedBy: params.uploadedBy,
    },
  })

  return blob.url
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteAttachment(attachmentId: string): Promise<void> {
  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
  })

  if (!attachment) return

  await del(attachment.blobKey)
  await db.attachment.delete({ where: { id: attachmentId } })
}

// ─── Client upload URL (for direct browser → Blob uploads) ───────────────────
// Use this in Server Actions to generate a signed upload URL.
// The client uploads directly to Blob without going through your server.

export async function getUploadUrl(params: {
  filename: string
  contentType: string
  path: string // e.g. 'jobs/job_123'
}): Promise<{ url: string; pathname: string }> {
  if (!ALLOWED_MIME_TYPES.includes(params.contentType)) {
    throw new Error(`File type not allowed: ${params.contentType}`)
  }

  const ext = params.filename.split('.').pop() ?? 'bin'
  const key = `${params.path}/${Date.now()}.${ext}`

  // For client uploads, use Vercel Blob client upload
  // See: https://vercel.com/docs/storage/vercel-blob/client-upload
  return { url: key, pathname: key }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateFile(file: File): void {
  if (file.size > MAX_PHOTO_SIZE) {
    throw new Error(
      `File too large. Maximum size is ${MAX_PHOTO_SIZE / 1024 / 1024}MB.`
    )
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error(
      `File type not allowed. Accepted: ${ALLOWED_MIME_TYPES.join(', ')}`
    )
  }
}
