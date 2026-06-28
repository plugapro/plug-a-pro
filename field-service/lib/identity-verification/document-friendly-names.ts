import type { IdentityBasis } from '@prisma/client'

// Provider-readable labels for the {{2}} body parameter of the
// provider_verification_resume_document WhatsApp template — read literally as
// "...just needs your {{2}} photo. Tap the button below to upload it."
//
// Keep the phrasing short, sentence-case for nouns, and natural in that
// sentence. "passport photo page" reads as "your passport photo page photo" —
// awkward but clear; alternatives like "passport ID page" tested worse with
// pilot providers.
const DOCUMENT_FRIENDLY_NAMES: Record<IdentityBasis, string> = {
  SA_ID: 'SA ID',
  PASSPORT: 'passport photo page',
  REFUGEE_ID: 'refugee ID',
  ASYLUM_PERMIT: 'asylum permit',
  REFUGEE_PERMIT: 'refugee permit',
  WORK_PERMIT: 'work permit',
  PERMANENT_RESIDENCE_PERMIT: 'permanent residence permit',
}

export function documentFriendlyName(basis: IdentityBasis): string {
  return DOCUMENT_FRIENDLY_NAMES[basis]
}
