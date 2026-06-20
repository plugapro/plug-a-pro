// ─── Promote WhatsApp in-channel KYC captures → ProviderIdentityVerification ──
//
// The WhatsApp registration flow already captures provider ID number, an ID
// document photo and a selfie into the ProviderApplication record and its
// linked Attachments (with the structured labels
// PROVIDER_ID_DOCUMENT_LABEL / PROVIDER_ID_SELFIE_LABEL).
//
// Historically that data was "decorative" - it never produced a
// ProviderIdentityVerification row, so the admin review queue had nothing to
// act on. This module promotes that captured data into a real
// ProviderIdentityVerification (status SUBMITTED, assuranceLevel LOW, channel
// WHATSAPP) so the existing admin review queue can approve or reject it.
//
// Constraints:
//   - Behind feature flag `provider.kyc.promote_in_channel_captures` (default
//     OFF). When OFF, the function is a no-op.
//   - Idempotent: if a ProviderIdentityVerification already exists for the
//     provider (any channel), do nothing.
//   - Fail-safe: catches all errors and returns a structured outcome so the
//     admin approval transaction can NEVER fail because of a promotion glitch.
//   - Best-effort document copy: failures to mirror Attachment rows into
//     ProviderIdentityDocument rows do not invalidate the verification row.

import type { IdentityDocumentKind } from '@prisma/client'

import { db } from '../db'
import { isEnabled } from '../flags'
import {
  PROVIDER_ID_DOCUMENT_LABEL,
  PROVIDER_ID_SELFIE_LABEL,
} from '../provider-attachment-labels'

export const PROMOTE_CAPTURES_FLAG = 'provider.kyc.promote_in_channel_captures' as const

// Mirror the raw-document retention used by lib/identity-verification/storage.ts
// (60 days). Each ProviderIdentityDocument must carry a deleteAfter date.
const RAW_DOCUMENT_RETENTION_DAYS = 60

export type PromoteApplicationCapturesInput = {
  applicationId: string
  providerId: string
  now?: Date
}

export type PromoteApplicationCapturesOutcome =
  | { outcome: 'flag_off' }
  | { outcome: 'no_application' }
  | { outcome: 'no_captures' }
  | { outcome: 'already_exists'; verificationId: string }
  | { outcome: 'created'; verificationId: string }
  | { outcome: 'error'; error: string }

type ApplicationCapture = {
  id: string
  providerId: string | null
  idNumber: string | null
  attachments: Array<{
    id: string
    label: string | null
    blobKey: string
    mimeType: string
    sizeBytes: number
  }>
}

/**
 * Promote WhatsApp in-channel identity captures into a real
 * ProviderIdentityVerification row at admin approval time.
 *
 * See module header for full contract.
 */
export async function promoteApplicationCapturesToVerification(
  input: PromoteApplicationCapturesInput,
): Promise<PromoteApplicationCapturesOutcome> {
  try {
    const flagEnabled = await isEnabled(PROMOTE_CAPTURES_FLAG, { userId: input.providerId })
    if (!flagEnabled) {
      return { outcome: 'flag_off' }
    }

    const application = (await db.providerApplication.findUnique({
      where: { id: input.applicationId },
      select: {
        id: true,
        providerId: true,
        idNumber: true,
        attachments: {
          select: {
            id: true,
            label: true,
            blobKey: true,
            mimeType: true,
            sizeBytes: true,
          },
        },
      },
    })) as ApplicationCapture | null

    if (!application) {
      return { outcome: 'no_application' }
    }

    const idNumber = application.idNumber?.trim() ?? ''
    const docAttachment = application.attachments.find(
      (a) => a.label === PROVIDER_ID_DOCUMENT_LABEL,
    )
    const selfieAttachment = application.attachments.find(
      (a) => a.label === PROVIDER_ID_SELFIE_LABEL,
    )

    // We require at least an ID number AND (doc or selfie) to consider this a
    // promotable capture. Older / partial applications fall through cleanly.
    if (!idNumber || (!docAttachment && !selfieAttachment)) {
      return { outcome: 'no_captures' }
    }

    // Idempotency: if any verification already exists for this provider, do
    // nothing. The admin review queue can act on the existing row; we never
    // duplicate.
    const existing = await db.providerIdentityVerification.findFirst({
      where: { providerId: input.providerId },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    })

    if (existing) {
      return { outcome: 'already_exists', verificationId: existing.id }
    }

    const identityBasis = deriveIdentityBasis(idNumber)

    const verification = await db.providerIdentityVerification.create({
      data: {
        providerId: input.providerId,
        providerApplicationId: input.applicationId,
        channel: 'WHATSAPP',
        identityBasis,
        status: 'SUBMITTED',
        assuranceLevel: 'LOW',
        identifierLast4: idNumber.slice(-4),
      },
      select: { id: true },
    })

    // Best-effort: mirror the captured Attachments into
    // ProviderIdentityDocument rows so the admin review queue can render them
    // through the existing identity document UI. Any failure here is swallowed
    // - the verification row is what enables the admin queue; the mirror is a
    // convenience.
    const now = input.now ?? new Date()
    const deleteAfter = addDays(now, RAW_DOCUMENT_RETENTION_DAYS)

    if (docAttachment) {
      await safeCreateIdentityDocument({
        verificationId: verification.id,
        documentKind: identityBasis === 'PASSPORT' ? 'PASSPORT_PHOTO_PAGE' : 'ID_FRONT',
        attachment: docAttachment,
        deleteAfter,
      })
    }
    if (selfieAttachment) {
      await safeCreateIdentityDocument({
        verificationId: verification.id,
        documentKind: 'SELFIE',
        attachment: selfieAttachment,
        deleteAfter,
      })
    }

    return { outcome: 'created', verificationId: verification.id }
  } catch (error) {
    console.error('[identity-verification:promote-application-captures] failed', {
      applicationId: input.applicationId,
      providerId: input.providerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      outcome: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function deriveIdentityBasis(rawIdNumber: string): 'SA_ID' | 'PASSPORT' {
  const digitsOnly = rawIdNumber.replace(/\D/g, '')
  return digitsOnly.length === 13 && digitsOnly === rawIdNumber ? 'SA_ID' : 'PASSPORT'
}

async function safeCreateIdentityDocument(params: {
  verificationId: string
  documentKind: IdentityDocumentKind
  attachment: {
    id: string
    blobKey: string
    mimeType: string
    sizeBytes: number
  }
  deleteAfter: Date
}): Promise<void> {
  try {
    await db.providerIdentityDocument.create({
      data: {
        verificationId: params.verificationId,
        documentKind: params.documentKind,
        blobKey: params.attachment.blobKey,
        mimeType: params.attachment.mimeType,
        sizeBytes: params.attachment.sizeBytes,
        // The Attachment row does not carry a sha256 - use the attachment id as
        // a stable, unique-per-source-blob placeholder so the NOT NULL column
        // is satisfied. Admin tooling can recompute later if needed.
        sha256: `wa_attachment:${params.attachment.id}`,
        deleteAfter: params.deleteAfter,
      },
    })
  } catch (error) {
    console.warn(
      '[identity-verification:promote-application-captures] document mirror failed (non-fatal)',
      {
        verificationId: params.verificationId,
        attachmentId: params.attachment.id,
        documentKind: params.documentKind,
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}
