// ─── Vercel Blob — file storage helpers ──────────────────────────────────────
// Used for: job request evidence, completion photos, quote attachments, and avatars.

import { put, del, get } from '@vercel/blob'
import { db } from './db'

const MAX_PHOTO_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const

const ALLOWED_EXTENSIONS_BY_MIME: Record<(typeof ALLOWED_MIME_TYPES)[number], string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic', 'heif'],
  'image/heif': ['heif', 'heic'],
  'application/pdf': ['pdf'],
}

function isAllowedMimeType(value: string): value is (typeof ALLOWED_MIME_TYPES)[number] {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value)
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export async function uploadJobPhoto(params: {
  jobId: string
  file: File
  label?: 'before' | 'after' | 'evidence' | string
  caption?: string | null
  uploadedBy: string
}): Promise<string> {
  await validateFile(params.file)

  const ext = safeExtension(params.file)
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
  safeForPreview?: boolean
}): Promise<string> {
  await validateFile(params.file)

  const ext = safeExtension(params.file)
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
      safeForPreview: params.safeForPreview ?? true,
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
  await validateFile(params.file)

  const ext = safeExtension(params.file)
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

export async function uploadProviderPaymentProof(params: {
  paymentIntentId: string
  file: File
}): Promise<string> {
  await validateFile(params.file)

  const ext = safeExtension(params.file)
  const key = `provider-credit-payments/${params.paymentIntentId}/${Date.now()}-proof.${ext}`

  const blob = await put(key, params.file, {
    access: 'private',
    addRandomSuffix: true,
    contentType: params.file.type,
    cacheControlMaxAge: 60,
  })

  return blob.url
}

export async function getProviderPaymentProof(url: string) {
  return get(url, {
    access: 'private',
    useCache: false,
  })
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
  if (!isAllowedMimeType(params.contentType)) {
    throw new Error(`File type not allowed: ${params.contentType}`)
  }

  const ext = params.filename.split('.').pop()?.toLowerCase() ?? 'bin'
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_MIME[params.contentType]
  if (!allowedExtensions?.includes(ext)) {
    throw new Error(`File extension not allowed for ${params.contentType}`)
  }
  const key = `${params.path}/${Date.now()}.${ext}`

  // For client uploads, use Vercel Blob client upload
  // See: https://vercel.com/docs/storage/vercel-blob/client-upload
  return { url: key, pathname: key }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function safeExtension(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!isAllowedMimeType(file.type)) {
    throw new Error(
      `File type not allowed. Accepted: ${ALLOWED_MIME_TYPES.join(', ')}`
    )
  }
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_MIME[file.type]
  if (!ext || !allowedExtensions?.includes(ext)) {
    throw new Error(`File extension not allowed for ${file.type || 'unknown type'}`)
  }
  return ext
}

async function validateFile(file: File): Promise<void> {
  if (file.size > MAX_PHOTO_SIZE) {
    throw new Error(
      `File too large. Maximum size is ${MAX_PHOTO_SIZE / 1024 / 1024}MB.`
    )
  }
  safeExtension(file)
  if (!(await fileSignatureMatches(file))) {
    throw new Error(`File content does not match declared type: ${file.type}`)
  }
}

async function fileSignatureMatches(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (file.type === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (file.type === 'image/png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  }
  if (file.type === 'image/webp') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
  }
  if (file.type === 'image/heic' || file.type === 'image/heif') {
    const brand = ascii(bytes, 8, 4)
    return ascii(bytes, 4, 4) === 'ftyp' && ['heic', 'heif', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)
  }
  if (file.type === 'application/pdf') {
    return ascii(bytes, 0, 5) === '%PDF-'
  }
  return false
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}
