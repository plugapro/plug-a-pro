export type AgeBucket = 'lt_24h' | '1_to_3d' | '3_to_7d' | 'gt_7d' | 'unknown'

export type AttachmentRow = {
  id: string
  mediaId: string
  url: string
  label: string | null
  parentKind: 'providerApplication' | 'jobRequest' | 'job' | 'inspectionSlot' | null
  parentId: string | null
}

export type MediaIdIndex = Map<string, Date>   // mediaId -> firstSeenAt

export type HeadResult = {
  attachmentId: string
  status: 'alive' | 'dead' | 'error'
  httpStatus: number | null
  errorMessage: string | null
  durationMs: number
}

export type GapRow = {
  attachmentId: string
  mediaIdSuffix: string
  ageBucket: AgeBucket
  parentKind: string | null
  parentId: string | null
  label: string | null
  httpStatus: number | null
  firstSeenAt: string | null
  replayable: boolean
  reason: string
}
