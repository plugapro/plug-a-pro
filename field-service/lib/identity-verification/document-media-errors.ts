import type { IdentityDocumentKind } from './types'

export type IdentityDocumentMediaErrorCode =
  | 'WHATSAPP_MEDIA_ID_MISSING'
  | 'WHATSAPP_ACCESS_TOKEN_MISSING'
  | 'WHATSAPP_MEDIA_METADATA_FETCH_FAILED'
  | 'WHATSAPP_MEDIA_DOWNLOAD_FAILED'
  | 'UNSUPPORTED_DOCUMENT_MIME_TYPE'
  | 'DOCUMENT_FILE_TOO_LARGE'
  | 'DOCUMENT_STORAGE_BUCKET_MISSING'
  | 'DOCUMENT_STORAGE_UPLOAD_FAILED'
  | 'VERIFICATION_DOCUMENT_DB_WRITE_FAILED'
  | 'VERIFICATION_STATE_UPDATE_FAILED'
  | 'DUPLICATE_WEBHOOK_MESSAGE_IGNORED'

export type IdentityDocumentMediaOperation =
  | 'whatsapp_media_id_extract'
  | 'whatsapp_media_metadata_fetch'
  | 'whatsapp_media_download'
  | 'document_mime_validation'
  | 'document_size_validation'
  | 'document_storage_upload'
  | 'verification_document_db_write'
  | 'verification_state_update'
  | 'webhook_duplicate_guard'

export type IdentityDocumentMediaErrorInput = {
  code: IdentityDocumentMediaErrorCode
  operation: IdentityDocumentMediaOperation
  message: string
  cause?: unknown
  status?: number
  verificationId?: string
  documentKind?: IdentityDocumentKind
  mediaIdSuffix?: string
  mimeType?: string
  sizeBytes?: number
  maxSizeBytes?: number
  storageProvider?: string
  storageBucketName?: string
}

export class IdentityDocumentMediaError extends Error {
  readonly code: IdentityDocumentMediaErrorCode
  readonly operation: IdentityDocumentMediaOperation
  readonly cause?: unknown
  readonly status?: number
  readonly verificationId?: string
  readonly documentKind?: IdentityDocumentKind
  readonly mediaIdSuffix?: string
  readonly mimeType?: string
  readonly sizeBytes?: number
  readonly maxSizeBytes?: number
  readonly storageProvider?: string
  readonly storageBucketName?: string

  constructor(input: IdentityDocumentMediaErrorInput) {
    super(input.message)
    this.name = 'IdentityDocumentMediaError'
    this.code = input.code
    this.operation = input.operation
    this.cause = input.cause
    this.status = input.status
    this.verificationId = input.verificationId
    this.documentKind = input.documentKind
    this.mediaIdSuffix = input.mediaIdSuffix
    this.mimeType = input.mimeType
    this.sizeBytes = input.sizeBytes
    this.maxSizeBytes = input.maxSizeBytes
    this.storageProvider = input.storageProvider
    this.storageBucketName = input.storageBucketName
  }
}

export function isIdentityDocumentMediaError(error: unknown): error is IdentityDocumentMediaError {
  return error instanceof IdentityDocumentMediaError
}

export function toIdentityDocumentMediaError(
  error: unknown,
  fallback: IdentityDocumentMediaErrorInput,
): IdentityDocumentMediaError {
  if (isIdentityDocumentMediaError(error)) return error
  return new IdentityDocumentMediaError({
    ...fallback,
    cause: error,
  })
}

export function safeMediaIdSuffix(mediaId: string | null | undefined): string | undefined {
  if (!mediaId) return undefined
  return mediaId.slice(-8)
}

export function safeIdentityDocumentMediaErrorLog(
  error: IdentityDocumentMediaError,
  fallback?: Partial<Pick<IdentityDocumentMediaErrorInput, 'verificationId' | 'documentKind' | 'mediaIdSuffix' | 'mimeType' | 'sizeBytes' | 'maxSizeBytes' | 'storageProvider' | 'storageBucketName'>>,
) {
  return {
    code: error.code,
    failedOperationName: error.operation,
    verificationId: error.verificationId ?? fallback?.verificationId,
    documentKind: error.documentKind ?? fallback?.documentKind,
    mediaIdSuffix: error.mediaIdSuffix ?? fallback?.mediaIdSuffix,
    mimeType: error.mimeType ?? fallback?.mimeType,
    sizeBytes: error.sizeBytes ?? fallback?.sizeBytes,
    maxSizeBytes: error.maxSizeBytes ?? fallback?.maxSizeBytes,
    status: error.status,
    storageProvider: error.storageProvider ?? fallback?.storageProvider,
    storageBucketName: error.storageBucketName ?? fallback?.storageBucketName,
  }
}
