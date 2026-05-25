import { createHash } from 'crypto'

import { db } from '../db'
import { uploadIdentityDocument } from '../storage'
import type { IdentityDocumentKind } from './types'

const RAW_DOCUMENT_RETENTION_DAYS = 60

export async function storeIdentityDocument(params: {
  verificationId: string
  documentKind: IdentityDocumentKind
  file: File
  now?: Date
}) {
  const uploaded = await uploadIdentityDocument({
    verificationId: params.verificationId,
    documentKind: params.documentKind,
    file: params.file,
  })
  const now = params.now ?? new Date()

  return db.providerIdentityDocument.create({
    data: {
      verificationId: params.verificationId,
      documentKind: params.documentKind,
      blobKey: uploaded.pathname,
      mimeType: params.file.type,
      sizeBytes: params.file.size,
      sha256: await sha256File(params.file),
      deleteAfter: addDays(now, RAW_DOCUMENT_RETENTION_DAYS),
    },
  })
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
