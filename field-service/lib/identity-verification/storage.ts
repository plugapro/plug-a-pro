import { createHash } from 'crypto'

import { db } from '../db'
import { uploadIdentityDocument } from '../storage'
import {
  IdentityDocumentMediaError,
  safeIdentityDocumentMediaErrorLog,
  toIdentityDocumentMediaError,
} from './document-media-errors'
import type { IdentityDocumentKind } from './types'

const RAW_DOCUMENT_RETENTION_DAYS = 60
const IDENTITY_STORAGE_PROVIDER = 'supabase_storage'
const IDENTITY_STORAGE_BUCKET_NAME = process.env.IDENTITY_DOCUMENT_BUCKET?.trim() || 'identity-documents'

export async function storeIdentityDocument(params: {
  verificationId: string
  documentKind: IdentityDocumentKind
  file: File
  now?: Date
}) {
  let uploaded: Awaited<ReturnType<typeof uploadIdentityDocument>>
  try {
    // Keep validation and private Blob upload in one classified operation: callers
    // only need to know whether protected document storage accepted the file.
    uploaded = await uploadIdentityDocument({
      verificationId: params.verificationId,
      documentKind: params.documentKind,
      file: params.file,
    })
    console.info('[identity-verification:storage] document uploaded to protected storage', {
      verificationId: params.verificationId,
      documentKind: params.documentKind,
      mimeType: params.file.type,
      sizeBytes: params.file.size,
      storageProvider: IDENTITY_STORAGE_PROVIDER,
      storageBucketName: IDENTITY_STORAGE_BUCKET_NAME,
    })
  } catch (error) {
    const classified = toIdentityDocumentMediaError(error, {
      code: 'DOCUMENT_STORAGE_UPLOAD_FAILED',
      operation: 'document_storage_upload',
      message: 'Identity document storage upload failed',
      verificationId: params.verificationId,
      documentKind: params.documentKind,
      mimeType: params.file.type,
      sizeBytes: params.file.size,
      storageProvider: IDENTITY_STORAGE_PROVIDER,
      storageBucketName: IDENTITY_STORAGE_BUCKET_NAME,
    })
    console.error(
      '[identity-verification:storage] document storage upload failed',
      safeIdentityDocumentMediaErrorLog(classified, {
        verificationId: params.verificationId,
        documentKind: params.documentKind,
        mimeType: params.file.type,
        sizeBytes: params.file.size,
        storageProvider: IDENTITY_STORAGE_PROVIDER,
        storageBucketName: IDENTITY_STORAGE_BUCKET_NAME,
      }),
    )
    throw classified
  }
  const now = params.now ?? new Date()

  try {
    // The database row is the only supported way to retrieve a private raw
    // identity document later; failures here must be distinguishable from Blob.
    const digest = await sha256File(params.file)
    return await db.providerIdentityDocument.create({
      data: {
        verificationId: params.verificationId,
        documentKind: params.documentKind,
        blobKey: uploaded.pathname,
        mimeType: params.file.type,
        sizeBytes: params.file.size,
        sha256: digest,
        deleteAfter: addDays(now, RAW_DOCUMENT_RETENTION_DAYS),
      },
    })
  } catch (error) {
    const classified = error instanceof IdentityDocumentMediaError
      ? error
      : new IdentityDocumentMediaError({
        code: 'VERIFICATION_DOCUMENT_DB_WRITE_FAILED',
        operation: 'verification_document_db_write',
        message: 'Identity document metadata write failed',
        cause: error,
        verificationId: params.verificationId,
        documentKind: params.documentKind,
        mimeType: params.file.type,
        sizeBytes: params.file.size,
        storageProvider: IDENTITY_STORAGE_PROVIDER,
        storageBucketName: IDENTITY_STORAGE_BUCKET_NAME,
      })
    console.error(
      '[identity-verification:storage] document metadata DB write failed',
      safeIdentityDocumentMediaErrorLog(classified, {
        verificationId: params.verificationId,
        documentKind: params.documentKind,
        mimeType: params.file.type,
        sizeBytes: params.file.size,
        storageProvider: IDENTITY_STORAGE_PROVIDER,
        storageBucketName: IDENTITY_STORAGE_BUCKET_NAME,
      }),
    )
    throw classified
  }
}

async function sha256File(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer())
  return createHash('sha256').update(bytes).digest('hex')
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}
