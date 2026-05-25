'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashIdentifier, identifierLast4 } from '@/lib/identity-verification/crypto'
import { validateIdentityDocumentDetails } from '@/lib/identity-verification/document-validation'
import { transitionIdentityVerification } from '@/lib/identity-verification/orchestrator'
import { getRequiredDocumentKinds, type IdentityBasis, type IdentityDocumentKind, type VerificationStatus } from '@/lib/identity-verification/types'
import { resolveProviderVerificationToken } from '@/lib/provider-verification-token'

const IdentityBasisSchema = z.enum([
  'SA_ID',
  'PASSPORT',
  'REFUGEE_ID',
  'ASYLUM_PERMIT',
  'REFUGEE_PERMIT',
  'WORK_PERMIT',
  'PERMANENT_RESIDENCE_PERMIT',
])

const IdentifierSchema = z.object({
  identityBasis: IdentityBasisSchema,
  identifier: z.string().min(4).max(80),
  issuingCountry: z.string().max(80).optional(),
  nationality: z.string().max(80).optional(),
  documentExpiryDate: z.string().optional(),
})

export type SubmitIdentityBasisAndIdentifierInput = z.infer<typeof IdentifierSchema>

export async function acceptIdentityConsent(token: string) {
  const verification = await resolveProviderVerificationToken(token)

  if (verification.status === 'NOT_STARTED') {
    await transitionIdentityVerification({
      verificationId: verification.id,
      toStatus: 'STARTED',
      actorId: verification.providerId ?? undefined,
      actorRole: 'provider',
    })
  }

  if (verification.status !== 'CONSENTED') {
    await transitionIdentityVerification({
      verificationId: verification.id,
      toStatus: 'CONSENTED',
      actorId: verification.providerId ?? undefined,
      actorRole: 'provider',
      metadata: { consentAccepted: true },
      data: { consentAcceptedAt: new Date() },
    })
  }

  revalidatePath(`/provider/verify/${token}`)
  return { ok: true as const }
}

export async function submitIdentityBasisAndIdentifier(
  token: string,
  rawInput: SubmitIdentityBasisAndIdentifierInput,
) {
  const verification = await resolveProviderVerificationToken(token)
  const input = IdentifierSchema.parse(rawInput)
  const validation = validateIdentityDocumentDetails(input)

  if (!validation.ok) {
    throw new Error(validation.message)
  }

  await db.providerIdentityVerification.update({
    where: { id: verification.id },
    data: {
      identityBasis: input.identityBasis,
      issuingCountry: validation.issuingCountry,
      nationality: validation.nationality,
      identifierHash: hashIdentifier(validation.normalizedIdentifier, `identity:${input.identityBasis}`),
      identifierLast4: identifierLast4(validation.normalizedIdentifier),
      documentNumberHash: null,
      documentNumberLast4: null,
      documentExpiryDate: validation.documentExpiryDate,
      dobDerived: validation.dateOfBirth ?? null,
      genderDerived: validation.gender ?? null,
      citizenshipDerived: validation.citizenship ?? null,
    },
  })

  await advanceTo(verification.id, verification.status as VerificationStatus, 'AWAITING_IDENTIFIER', {
    actorId: verification.providerId ?? undefined,
    metadata: { identityBasis: input.identityBasis },
  })
  await transitionIdentityVerification({
    verificationId: verification.id,
    toStatus: 'AWAITING_DOCUMENT',
    actorId: verification.providerId ?? undefined,
    actorRole: 'provider',
    metadata: { identifierCaptured: true, identityBasis: input.identityBasis },
  })

  revalidatePath(`/provider/verify/${token}`)
  return { ok: true as const }
}

export async function submitIdentityDocuments(token: string) {
  const verification = await resolveProviderVerificationToken(token)
  const existingKinds = await getUploadedDocumentKinds(verification.id)
  const missingDocuments = requiredKindsForStep(verification.identityBasis as IdentityBasis, 'documents')
    .filter((kind) => !existingKinds.has(kind))

  if (missingDocuments.length > 0) {
    return { ok: false as const, code: 'MISSING_DOCUMENTS', missingDocuments }
  }

  await transitionIdentityVerification({
    verificationId: verification.id,
    toStatus: 'AWAITING_SELFIE',
    actorId: verification.providerId ?? undefined,
    actorRole: 'provider',
    metadata: { documentUploadComplete: true },
  })

  revalidatePath(`/provider/verify/${token}`)
  return { ok: true as const }
}

export async function submitIdentitySelfie(token: string) {
  const verification = await resolveProviderVerificationToken(token)
  const existingKinds = await getUploadedDocumentKinds(verification.id)

  if (!existingKinds.has('SELFIE')) {
    return { ok: false as const, code: 'MISSING_SELFIE' }
  }

  await transitionIdentityVerification({
    verificationId: verification.id,
    toStatus: 'SUBMITTED',
    actorId: verification.providerId ?? undefined,
    actorRole: 'provider',
    metadata: { selfieUploadComplete: true },
  })

  revalidatePath(`/provider/verify/${token}`)
  return { ok: true as const }
}

export async function submitIdentityVerificationForReview(token: string) {
  const verification = await resolveProviderVerificationToken(token)
  const existingKinds = await getUploadedDocumentKinds(verification.id)
  const missingDocuments = getRequiredDocumentKinds(verification.identityBasis as IdentityBasis)
    .filter((kind) => !existingKinds.has(kind))

  if (missingDocuments.length > 0) {
    return { ok: false as const, code: 'MISSING_DOCUMENTS', missingDocuments }
  }

  if (verification.status === 'AWAITING_SELFIE') {
    await transitionIdentityVerification({
      verificationId: verification.id,
      toStatus: 'SUBMITTED',
      actorId: verification.providerId ?? undefined,
      actorRole: 'provider',
      metadata: { submittedFrom: 'pwa' },
    })
  }

  await transitionIdentityVerification({
    verificationId: verification.id,
    toStatus: 'NEEDS_MANUAL_REVIEW',
    decision: 'MANUAL_REVIEW',
    actorId: verification.providerId ?? undefined,
    actorRole: 'provider',
    metadata: { submittedForManualReview: true },
    data: { assuranceLevel: 'MEDIUM' },
  })

  revalidatePath(`/provider/verify/${token}`)
  return { ok: true as const }
}

async function getUploadedDocumentKinds(verificationId: string): Promise<Set<IdentityDocumentKind>> {
  const rows = await db.providerIdentityDocument.findMany({
    where: { verificationId, deletedAt: null },
    select: { documentKind: true },
  })
  return new Set(rows.map((row) => row.documentKind as IdentityDocumentKind))
}

async function advanceTo(
  verificationId: string,
  currentStatus: VerificationStatus,
  toStatus: VerificationStatus,
  options: { actorId?: string; metadata?: Record<string, unknown> },
) {
  if (currentStatus === toStatus) return
  await transitionIdentityVerification({
    verificationId,
    toStatus,
    actorId: options.actorId,
    actorRole: 'provider',
    metadata: options.metadata,
  })
}

function requiredKindsForStep(identityBasis: IdentityBasis, step: 'documents' | 'selfie') {
  const kinds = getRequiredDocumentKinds(identityBasis)
  return step === 'selfie'
    ? kinds.filter((kind) => kind === 'SELFIE')
    : kinds.filter((kind) => kind !== 'SELFIE')
}
