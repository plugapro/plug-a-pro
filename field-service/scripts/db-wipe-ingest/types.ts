import type { MetaAgeBucket } from '../whatsapp-blob-audit/types'

export type IngestPlanRow = {
  mediaId: string
  mediaIdSuffix: string
  messageType: 'image' | 'document' | 'video'
  phoneMasked: string
  phoneTail: string
  firstSeenAt: string
  ageBucket: MetaAgeBucket
  parentKind: 'providerApplication' | null
  parentId: string | null
  parentConfidence: 'HIGH' | 'MEDIUM' | 'NONE'
  label: string
}

export type IngestSkippedRow = {
  mediaId: string
  mediaIdSuffix: string
  phoneMasked: string
  phoneTail: string
  ageBucket: MetaAgeBucket
  reason: 'beyond_meta_retention'
}

export type AttachmentSnapshot = {
  totalCount: number
  whatsappCount: number
  maxCreatedAt: string | null
}

export type IngestPlan = {
  version: 1
  generatedAt: string
  attachmentSnapshot: AttachmentSnapshot
  totalCandidates: number
  totalMissing: number
  planned: number
  skipped: number
  rows: IngestPlanRow[]
  skippedRows: IngestSkippedRow[]
}

export type IngestResult = {
  mediaIdSuffix: string
  mediaId: string
  status: 'success' | 'skipped' | 'failed'
  attachmentId: string | null
  errorCode: string | null
  errorMessage: string | null
  durationMs: number
}
