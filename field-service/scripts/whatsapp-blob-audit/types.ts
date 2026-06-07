export type AgeBucket = 'lt_24h' | '1_to_3d' | '3_to_7d' | 'gt_7d' | 'unknown'

// Meta WhatsApp media retention is 30 days. The dead-blob audit (csv.ts) keeps
// the 7-day bucket because that's the Vercel Blob cache horizon; the
// missing-row audit (missing-rows.ts) uses MetaAgeBucket so it can tell
// 7-to-30-day rows (still replayable from Meta) apart from > 30-day rows.
export type MetaAgeBucket = 'lt_24h' | '1_to_3d' | '3_to_7d' | '7_to_30d' | 'gt_30d' | 'unknown'

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

export type InboundMediaCandidate = {
  mediaId: string
  phone: string
  messageType: 'image' | 'document' | 'video'
  firstSeenAt: Date
}

// phone (normalized as stored in inbound_whatsapp_messages.phone) ->
// the ProviderApplication and JobRequest IDs that exist for that phone in
// live prod. Used as an FK-resolution hint in the missing-media inventory.
// Empty arrays mean "no rows found for that phone" — recovery will need to
// resort to phone+window+step matching or operator review.
export type PhoneParentHints = Map<string, {
  providerApplicationIds: string[]
  jobRequestIds: string[]
}>
