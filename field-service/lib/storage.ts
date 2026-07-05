// ─── Vercel Blob - file storage helpers ──────────────────────────────────────
// Used for: job request evidence, completion photos, quote attachments and avatars.

import { randomUUID } from 'crypto'
import { put, del, get } from '@vercel/blob'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db } from './db'

const MAX_PHOTO_SIZE = 10 * 1024 * 1024 // 10 MB
const IDENTITY_DOCUMENT_BUCKET_DEFAULT = 'identity-documents'
const SUPABASE_IDENTITY_REF_PREFIX = 'supabase://'
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

export async function uploadProviderProfilePhoto(file: File): Promise<string> {
  await validateFile(file)

  const ext = safeExtension(file)
  const key = `provider-registration/profile-photos/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`

  const blob = await put(key, file, {
    access: 'public',
    addRandomSuffix: true,
    contentType: file.type,
  })

  return blob.url
}

export async function uploadProviderEvidencePhoto(file: File): Promise<string> {
  await validateFile(file)

  const ext = safeExtension(file)
  const key = `provider-registration/evidence/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`

  const blob = await put(key, file, {
    access: 'public',
    addRandomSuffix: true,
    contentType: file.type,
  })

  return blob.url
}

export async function getProviderPaymentProof(url: string) {
  return get(url, {
    access: 'private',
    useCache: false,
  })
}

export async function uploadIdentityDocument(params: {
  verificationId: string
  documentKind: string
  file: File
}) {
  await validateFile(params.file)

  const ext = safeExtension(params.file)
  const bucket = identityDocumentBucketName()
  const key = `identity/${params.verificationId}/${params.documentKind}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
  const supabase = createSupabaseStorageClient()

  // Identity documents cannot use the existing Vercel Blob token because that
  // store is public-only. Keep KYC media in a private Supabase bucket and store
  // only an internal bucket/path reference in Postgres.
  await ensurePrivateIdentityDocumentBucket(supabase, bucket)

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(key, params.file, {
      contentType: params.file.type,
      cacheControl: '60',
      upsert: false,
    })

  if (error) {
    throw new Error(`Supabase identity document upload failed: ${safeStorageErrorMessage(error)}`)
  }

  return {
    pathname: supabaseIdentityReference(bucket, data?.path ?? key),
    url: null,
  }
}

export async function getIdentityDocument(blobKeyOrUrl: string) {
  const supabaseRef = parseSupabaseIdentityReference(blobKeyOrUrl)
  if (supabaseRef) {
    const supabase = createSupabaseStorageClient()
    const { data, error } = await supabase.storage
      .from(supabaseRef.bucket)
      .download(supabaseRef.path)

    if (error || !data) {
      return {
        statusCode: 404,
        stream: null,
        blob: {
          contentType: 'application/octet-stream',
          size: 0,
          contentDisposition: 'inline; filename="identity-document"',
        },
      }
    }

    return {
      statusCode: 200,
      stream: data.stream(),
      blob: {
        contentType: data.type || contentTypeFromFilename(supabaseRef.path),
        size: data.size,
        contentDisposition: `inline; filename="${safeDownloadFilename(supabaseRef.path)}"`,
      },
    }
  }

  // Legacy Vercel Blob references are still supported for any already-stored
  // rows, but new identity documents use the Supabase private bucket above.
  return get(blobKeyOrUrl, {
    access: 'private',
    useCache: false,
  })
}

export async function copyKycSelfieToProviderAvatar(params: {
  blobKey: string
  mimeType: string
  providerId: string
}): Promise<string> {
  const supabaseRef = parseSupabaseIdentityReference(params.blobKey)
  if (!supabaseRef) {
    throw new Error(`copyKycSelfieToProviderAvatar: unsupported reference format: ${params.blobKey}`)
  }

  const supabase = createSupabaseStorageClient()
  const { data, error } = await supabase.storage
    .from(supabaseRef.bucket)
    .download(supabaseRef.path)

  if (error || !data) {
    throw new Error(`KYC selfie download failed: ${safeStorageErrorMessage(error)}`)
  }

  const ext = params.mimeType === 'image/png' ? 'png' : 'jpg'
  const key = `avatars/providers/${params.providerId}/avatar.${ext}`

  const result = await put(key, data, {
    access: 'public',
    addRandomSuffix: false,
    contentType: params.mimeType,
  })

  return result.url
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export type IdentityDocumentDeleteResult = {
  backend: 'supabase' | 'vercel_blob' | 'unparseable'
  ok: boolean
  error?: string
}

export async function deleteIdentityDocumentByBlobKey(
  blobKey: string,
): Promise<IdentityDocumentDeleteResult> {
  const trimmedBlobKey = blobKey.trim()
  if (!trimmedBlobKey) {
    return {
      backend: 'unparseable',
      ok: false,
      error: 'Missing identity document reference',
    }
  }

  const supabaseRef = parseSupabaseIdentityReference(trimmedBlobKey)
  if (supabaseRef) {
    try {
      const supabase = createSupabaseStorageClient()
      const { error } = await supabase.storage
        .from(supabaseRef.bucket)
        .remove([supabaseRef.path])

      if (error) {
        return {
          backend: 'supabase',
          ok: false,
          error: safeStorageErrorMessage(error),
        }
      }
      return { backend: 'supabase', ok: true }
    } catch (error) {
      return {
        backend: 'supabase',
        ok: false,
        error: safeStorageErrorMessage(error),
      }
    }
  }

  if (trimmedBlobKey.startsWith(SUPABASE_IDENTITY_REF_PREFIX)) {
    return {
      backend: 'unparseable',
      ok: false,
      error: 'Malformed Supabase identity document reference',
    }
  }

  try {
    await del(trimmedBlobKey)
    return { backend: 'vercel_blob', ok: true }
  } catch (error) {
    return {
      backend: 'vercel_blob',
      ok: false,
      error: safeStorageErrorMessage(error),
    }
  }
}

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

function createSupabaseStorageClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase service role credentials for identity document storage')
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function ensurePrivateIdentityDocumentBucket(
  supabase: SupabaseClient,
  bucket: string,
): Promise<void> {
  const existing = await supabase.storage.getBucket(bucket)
  if (!existing.error && existing.data) {
    if (existing.data.public) {
      throw new Error(`Identity document storage bucket "${bucket}" must be private`)
    }
    return
  }

  if (existing.error && !isStorageNotFound(existing.error)) {
    throw new Error(
      `Identity document storage bucket lookup failed: ${safeStorageErrorMessage(existing.error)}`,
    )
  }

  const created = await supabase.storage.createBucket(bucket, {
    public: false,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
    fileSizeLimit: String(MAX_PHOTO_SIZE),
  })

  if (!created.error) return
  if (!isStorageAlreadyExists(created.error)) {
    throw new Error(
      `Identity document storage bucket creation failed: ${safeStorageErrorMessage(created.error)}`,
    )
  }

  // A concurrent request may have created the bucket first. Re-read it so a
  // public bucket never silently receives identity material.
  const afterRace = await supabase.storage.getBucket(bucket)
  if (afterRace.error || !afterRace.data) {
    throw new Error(
      `Identity document storage bucket lookup failed after create race: ${safeStorageErrorMessage(afterRace.error)}`,
    )
  }
  if (afterRace.data.public) {
    throw new Error(`Identity document storage bucket "${bucket}" must be private`)
  }
}

function identityDocumentBucketName(): string {
  return process.env.IDENTITY_DOCUMENT_BUCKET?.trim() || IDENTITY_DOCUMENT_BUCKET_DEFAULT
}

function supabaseIdentityReference(bucket: string, path: string): string {
  return `${SUPABASE_IDENTITY_REF_PREFIX}${bucket}/${path}`
}

function parseSupabaseIdentityReference(
  value: string,
): { bucket: string; path: string } | null {
  if (!value.startsWith(SUPABASE_IDENTITY_REF_PREFIX)) return null
  const withoutPrefix = value.slice(SUPABASE_IDENTITY_REF_PREFIX.length)
  const slashIndex = withoutPrefix.indexOf('/')
  if (slashIndex <= 0 || slashIndex === withoutPrefix.length - 1) return null
  return {
    bucket: withoutPrefix.slice(0, slashIndex),
    path: withoutPrefix.slice(slashIndex + 1),
  }
}

function safeDownloadFilename(path: string): string {
  return (path.split('/').pop() || 'identity-document')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
}

function contentTypeFromFilename(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'pdf') return 'application/pdf'
  return 'application/octet-stream'
}

function safeStorageErrorMessage(error: unknown): string {
  if (!error) return 'unknown'
  if (typeof error === 'object' && error !== null) {
    const status = 'statusCode' in error
      ? String((error as { statusCode?: unknown }).statusCode)
      : undefined
    const message = 'message' in error
      ? String((error as { message?: unknown }).message)
      : 'storage_error'
    return [status, message].filter(Boolean).join(' ')
  }
  return String(error)
}

function isStorageNotFound(error: unknown): boolean {
  const message = safeStorageErrorMessage(error).toLowerCase()
  return message.includes('404') || message.includes('not found')
}

function isStorageAlreadyExists(error: unknown): boolean {
  const message = safeStorageErrorMessage(error).toLowerCase()
  return message.includes('already exists') || message.includes('duplicate')
}
