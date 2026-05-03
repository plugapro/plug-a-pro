// ─── Provider attachment label taxonomy ──────────────────────────────────────
// Single source of truth for the labels used when storing provider-uploaded
// attachments. Use these constants instead of bare strings so that admin
// tooling, gallery rendering, and trust-signal computation stay in sync.
//
// Existing data: WhatsApp registration historically stored uploads as
// `evidence`. New code should prefer the structured labels below; admin can
// reclassify legacy `evidence` rows as needed.

export const PROVIDER_PROFILE_PHOTO_LABEL = 'provider_profile_photo'
export const PROVIDER_WORK_PHOTO_LABEL = 'provider_work_photo'
export const PROVIDER_ID_DOCUMENT_LABEL = 'provider_id_document'
export const PROVIDER_CERT_DOCUMENT_LABEL = 'provider_certification'

// Customer-facing display: profile photos are eligible for the avatar slot,
// work photos are eligible for the gallery, and ID/cert documents must never
// appear in any customer-facing render.
export const PROVIDER_CUSTOMER_VISIBLE_LABELS = [
  PROVIDER_PROFILE_PHOTO_LABEL,
  PROVIDER_WORK_PHOTO_LABEL,
] as const

export type ProviderAttachmentLabel =
  | typeof PROVIDER_PROFILE_PHOTO_LABEL
  | typeof PROVIDER_WORK_PHOTO_LABEL
  | typeof PROVIDER_ID_DOCUMENT_LABEL
  | typeof PROVIDER_CERT_DOCUMENT_LABEL

export function isProviderCustomerVisibleLabel(label: string | null | undefined): boolean {
  if (!label) return false
  return (PROVIDER_CUSTOMER_VISIBLE_LABELS as readonly string[]).includes(label)
}
