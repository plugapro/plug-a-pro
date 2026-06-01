import { db } from '../db'
import { isEnabled } from '../flags'
import { encryptIdentifier, hashIdentifier, identifierLast4, normalizeIdentifier } from '../identity-verification/crypto'
import {
  checkCanStartNewVerification,
  type VerificationStartCheck,
} from '../identity-verification/gate'
import {
  recordConsentAcceptance,
  renderIdentityConsentText,
} from '../identity-verification/consent-service'
import {
  IdentityDocumentMediaError,
  safeIdentityDocumentMediaErrorLog,
  safeMediaIdSuffix,
  toIdentityDocumentMediaError,
} from '../identity-verification/document-media-errors'
import {
  resolveIdentityVerificationConsentVendor,
  resolveIdentityVerificationConsentVendorForSubject,
  submitVerificationForAutomation,
  transitionIdentityVerification,
} from '../identity-verification/orchestrator'
import { validatePassportNumber, validateSaId } from '../identity-verification/sa-id'
import {
  getRequiredDocumentKinds,
  type IdentityBasis,
  type IdentityDocumentKind,
  type VerificationChannel,
  type VerificationStatus,
} from '../identity-verification/types'
import { sendButtons, sendList, sendText } from '../whatsapp-interactive'
import { downloadAndStoreWhatsAppIdentityDocument } from '../whatsapp-media'
import { phoneLookupVariants } from '../whatsapp-identity'
import { normalizePhone } from '../utils'
import type { FlowContext, FlowResult } from './types'

const IDENTITY_WHATSAPP_MEDIA_MAX_BYTES = 10 * 1024 * 1024

const IDENTITY_BASIS_ROWS: Array<{ basis: IdentityBasis; title: string; description: string }> = [
  { basis: 'SA_ID', title: 'SA ID', description: 'Smart ID card or green ID book' },
  { basis: 'PASSPORT', title: 'Passport', description: 'Foreign or South African passport' },
  { basis: 'REFUGEE_ID', title: 'Refugee ID', description: 'Refugee identity document' },
  { basis: 'ASYLUM_PERMIT', title: 'Asylum permit', description: 'Section 22 asylum seeker permit' },
  { basis: 'REFUGEE_PERMIT', title: 'Refugee permit', description: 'Section 24 refugee permit' },
  { basis: 'WORK_PERMIT', title: 'Work permit', description: 'Passport plus work permit' },
  { basis: 'PERMANENT_RESIDENCE_PERMIT', title: 'PR permit', description: 'Passport plus residence proof' },
]

export async function handleWhatsAppIdentityVerificationFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'pj_identity_start':
      return promptIdentityConsent(ctx)
    case 'pj_identity_consent':
      return handleIdentityConsent(ctx)
    case 'pj_identity_basis':
      return handleIdentityBasis(ctx)
    case 'pj_identity_identifier':
      return handleIdentityIdentifier(ctx)
    case 'pj_identity_document':
      return handleIdentityDocument(ctx)
    case 'pj_identity_selfie':
      return handleIdentitySelfie(ctx)
    default:
      return promptIdentityConsent(ctx)
  }
}

async function promptIdentityConsent(ctx: FlowContext): Promise<FlowResult> {
  const provider = await findProviderForIdentity(ctx.phone)
  const consentVendor = provider
    ? await resolveIdentityVerificationConsentVendorForSubject({ providerId: provider.id })
    : { vendorKey: 'manual' as const, vendorDisplayName: 'Plug A Pro review team' }
  const consentText = renderIdentityConsentText(consentVendor.vendorDisplayName)
  await sendButtons(
    ctx.phone,
    `POPIA consent: ${consentText} Do you agree?`,
    [
      { id: 'iv_consent_accept', title: 'I agree' },
      { id: 'iv_consent_decline', title: 'Not now' },
    ],
  )

  return {
    nextStep: 'pj_identity_consent',
    nextData: {
      identityConsentVendorKey: consentVendor.vendorKey,
      identityConsentVendorDisplayName: consentVendor.vendorDisplayName,
      identityConsentText: consentText,
    },
  }
}

async function handleIdentityConsent(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id !== 'iv_consent_accept') {
    await sendText(ctx.phone, 'No problem. You can verify later from the provider menu when you are ready.')
    return { nextStep: 'done', nextData: {} }
  }

  const provider = await findProviderForIdentity(ctx.phone)
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider yet. Reply *join* to apply.")
    return { nextStep: 'done', nextData: {} }
  }

  const failSafeEnabled = await isEnabled('provider.identity.verification.fail_safe', {
    userId: provider.id,
  })

  if (failSafeEnabled) {
    const gate = await checkCanStartNewVerification(provider.id, {
      purpose: 'GENERAL_IDENTITY',
    })

    if (gate.ok === false) {
      await sendText(ctx.phone, gate.message)
      return { nextStep: 'done', nextData: {} }
    }

    if (gate.ok === 'RESUME') {
      return resumeWhatsAppIdentityVerification(ctx, gate, { acceptedByProviderId: provider.id })
    }
  }

  const verification = await db.providerIdentityVerification.create({
    data: {
      providerId: provider.id,
      providerApplicationId: null,
      channel: 'WHATSAPP',
      identityBasis: 'SA_ID',
      status: 'NOT_STARTED',
      assuranceLevel: 'LOW',
    },
    select: { id: true, status: true },
  })
  const consentVendor = await resolveConsentVendorForWhatsApp(verification.id, ctx)

  await transitionIdentityVerification({
    verificationId: verification.id,
    toStatus: 'STARTED',
    actorId: provider.id,
    actorRole: 'provider',
  })
  await transitionIdentityVerification({
    verificationId: verification.id,
    toStatus: 'CONSENTED',
    actorId: provider.id,
    actorRole: 'provider',
    data: { consentAcceptedAt: new Date() },
  })
  await recordConsentAcceptance({
    verificationId: verification.id,
    vendorKey: consentVendor.vendorKey,
    vendorDisplayName: consentVendor.vendorDisplayName,
    consentText: consentVendor.consentText,
    channel: 'WHATSAPP',
    acceptedByProviderId: provider.id,
  })
  if (consentVendor.vendorKey === 'didit') {
    return submitHostedDiditFromWhatsApp(ctx, verification.id, provider.id)
  }
  await transitionIdentityVerification({
    verificationId: verification.id,
    toStatus: 'AWAITING_IDENTIFIER',
    actorId: provider.id,
    actorRole: 'provider',
  })
  await sendIdentityBasisList(ctx.phone)

  return {
    nextStep: 'pj_identity_basis',
    nextData: { identityVerificationId: verification.id },
  }
}

export async function resumeWhatsAppIdentityVerification(
  ctx: FlowContext,
  existing: Extract<VerificationStartCheck, { ok: 'RESUME' }>,
  options: { acceptedByProviderId?: string } = {},
): Promise<FlowResult> {
  const verification = await db.providerIdentityVerification.findUnique({
    where: { id: existing.verificationId },
    select: {
      id: true,
      status: true,
      identityBasis: true,
      channel: true,
    },
  }) as {
    id: string
    status: VerificationStatus
    identityBasis: IdentityBasis | null
    channel: VerificationChannel
  } | null

  if (!verification) {
    await sendText(ctx.phone, 'We could not find your verification session. Please start identity verification again from the provider menu.')
    return { nextStep: 'done', nextData: {} }
  }

  switch (verification.status) {
    case 'NOT_STARTED':
    case 'STARTED':
      if (!options.acceptedByProviderId) {
        return promptIdentityConsent(ctx)
      }

      if (verification.status === 'NOT_STARTED') {
        await transitionIdentityVerification({
          verificationId: verification.id,
          toStatus: 'STARTED',
          actorId: options.acceptedByProviderId,
          actorRole: 'provider',
        })
      }

      {
        const consentVendor = await resolveConsentVendorForWhatsApp(verification.id, ctx)
        await transitionIdentityVerification({
          verificationId: verification.id,
          toStatus: 'CONSENTED',
          actorId: options.acceptedByProviderId,
          actorRole: 'provider',
          data: { consentAcceptedAt: new Date() },
        })
        await recordConsentAcceptance({
          verificationId: verification.id,
          vendorKey: consentVendor.vendorKey,
          vendorDisplayName: consentVendor.vendorDisplayName,
          consentText: consentVendor.consentText,
          channel: 'WHATSAPP',
          acceptedByProviderId: options.acceptedByProviderId,
        })
        if (consentVendor.vendorKey === 'didit') {
          return submitHostedDiditFromWhatsApp(ctx, verification.id, options.acceptedByProviderId)
        }
        await transitionIdentityVerification({
          verificationId: verification.id,
          toStatus: 'AWAITING_IDENTIFIER',
          actorId: options.acceptedByProviderId,
          actorRole: 'provider',
        })
        await sendIdentityBasisList(ctx.phone)
        return {
          nextStep: 'pj_identity_basis',
          nextData: { identityVerificationId: verification.id },
        }
      }

    case 'CONSENTED':
      {
        const consentVendor = await resolveConsentVendorForWhatsApp(verification.id, ctx)
        if (consentVendor.vendorKey === 'didit') {
          return submitHostedDiditFromWhatsApp(ctx, verification.id, options.acceptedByProviderId)
        }
      }
      if (!verification.identityBasis) {
        await sendIdentityBasisList(ctx.phone)
        return {
          nextStep: 'pj_identity_basis',
          nextData: { identityVerificationId: verification.id },
        }
      }
      await sendText(ctx.phone, identifierPrompt(verification.identityBasis))
      return {
        nextStep: 'pj_identity_identifier',
        nextData: {
          identityVerificationId: verification.id,
          identityVerificationBasis: verification.identityBasis,
          identityVerificationDocumentKinds: requiredNonSelfieDocumentKinds(verification.identityBasis),
        },
      }

    case 'AWAITING_IDENTIFIER':
    case 'RETRY_REQUIRED': {
      const identityBasis = verification.identityBasis ?? 'SA_ID'
      await sendText(ctx.phone, identifierPrompt(identityBasis))
      return {
        nextStep: 'pj_identity_identifier',
        nextData: {
          identityVerificationId: verification.id,
          identityVerificationBasis: identityBasis,
          identityVerificationDocumentKinds: requiredNonSelfieDocumentKinds(identityBasis),
        },
      }
    }

    case 'AWAITING_DOCUMENT': {
      const identityBasis = verification.identityBasis ?? 'SA_ID'
      const documentKinds = requiredNonSelfieDocumentKinds(identityBasis)
      await sendText(ctx.phone, documentPrompt(documentKinds[0], identityBasis))
      return {
        nextStep: 'pj_identity_document',
        nextData: {
          identityVerificationId: verification.id,
          identityVerificationBasis: identityBasis,
          identityVerificationDocumentKinds: documentKinds,
        },
      }
    }

    case 'AWAITING_SELFIE': {
      const identityBasis = verification.identityBasis ?? 'SA_ID'
      await sendText(ctx.phone, 'Now send a clear selfie photo of your face. This WhatsApp option is reviewed manually and may still require a secure PWA liveness step before buying credits.')
      return {
        nextStep: 'pj_identity_selfie',
        nextData: {
          identityVerificationId: verification.id,
          identityVerificationBasis: identityBasis,
        },
      }
    }

    case 'AWAITING_LIVENESS':
      await sendText(ctx.phone, 'Your identity check needs the secure face-match step. Please complete the latest verification link we sent you.')
      return { nextStep: 'done', nextData: {} }

    case 'SUBMITTED':
    case 'PROCESSING':
    case 'NEEDS_MANUAL_REVIEW':
      await sendText(ctx.phone, "Your identity check is already in review. We'll message you when it is done.")
      return { nextStep: 'done', nextData: {} }


    case 'PASSED':
      await sendText(ctx.phone, 'Your identity verification is already complete.')
      return { nextStep: 'done', nextData: {} }

    case 'FAILED':
    case 'EXPIRED':
    case 'CANCELLED':
      await sendText(ctx.phone, 'Please start identity verification again from the provider menu when you are ready.')
      return { nextStep: 'done', nextData: {} }
  }
}

async function submitHostedDiditFromWhatsApp(
  ctx: FlowContext,
  verificationId: string,
  actorId?: string,
): Promise<FlowResult> {
  const metadata = { hostedSkip: true, vendor: 'didit', channel: 'whatsapp' }
  for (const toStatus of ['AWAITING_IDENTIFIER', 'AWAITING_DOCUMENT', 'AWAITING_SELFIE', 'SUBMITTED'] as const) {
    await transitionIdentityVerification({
      verificationId,
      toStatus,
      actorId,
      actorRole: actorId ? 'provider' : undefined,
      metadata,
    })
  }
  const automation = await submitVerificationForAutomation(verificationId)
  await sendAutomationOutcome(ctx.phone, automation)
  return { nextStep: 'done', nextData: {} }
}

async function handleIdentityBasis(ctx: FlowContext): Promise<FlowResult> {
  const verificationId = ctx.data.identityVerificationId
  const identityBasis = parseIdentityBasis(ctx.reply.id)
  if (!verificationId) {
    await sendText(ctx.phone, 'We could not find your verification session. Please start identity verification again from the provider menu.')
    return { nextStep: 'done', nextData: {} }
  }
  if (!identityBasis) {
    await sendIdentityBasisList(ctx.phone)
    return { nextStep: 'pj_identity_basis', nextData: { identityVerificationId: verificationId } }
  }

  const documentKinds = requiredNonSelfieDocumentKinds(identityBasis)
  await db.providerIdentityVerification.update({
    where: { id: verificationId },
    data: { identityBasis },
  })
  await sendText(ctx.phone, identifierPrompt(identityBasis))

  return {
    nextStep: 'pj_identity_identifier',
    nextData: {
      identityVerificationId: verificationId,
      identityVerificationBasis: identityBasis,
      identityVerificationDocumentKinds: documentKinds,
    },
  }
}

async function handleIdentityIdentifier(ctx: FlowContext): Promise<FlowResult> {
  const verificationId = ctx.data.identityVerificationId
  const identityBasis = ctx.data.identityVerificationBasis ?? 'SA_ID'
  const rawIdentifier = ctx.reply.text?.trim() ?? ''
  if (!verificationId) {
    await sendText(ctx.phone, 'We could not find your verification session. Please start identity verification again from the provider menu.')
    return { nextStep: 'done', nextData: {} }
  }

  const validation = validateIdentifierForBasis(identityBasis, rawIdentifier)
  if (!validation.ok) {
    await sendText(ctx.phone, invalidIdentifierMessage(identityBasis))
    return {
      nextStep: 'pj_identity_identifier',
      nextData: {
        identityVerificationId: verificationId,
        identityVerificationBasis: identityBasis,
        identityVerificationDocumentKinds: ctx.data.identityVerificationDocumentKinds,
      },
    }
  }

  await db.providerIdentityVerification.update({
    where: { id: verificationId },
    data: {
      identityBasis,
      identifierHash: hashIdentifier(validation.normalized, `identity:${identityBasis}`),
      identifierLast4: identifierLast4(validation.normalized),
      identifierEncrypted: encryptIdentifier(validation.normalized),
      documentNumberHash: null,
      documentNumberLast4: null,
      ...(validation.saId ? {
        dobDerived: validation.saId.dateOfBirth,
        genderDerived: validation.saId.gender,
        citizenshipDerived: validation.saId.citizenship,
      } : {}),
    },
  })
  await transitionIdentityVerification({
    verificationId,
    toStatus: 'AWAITING_DOCUMENT',
    metadata: { channel: 'whatsapp', identityBasis },
  })

  const documentKinds = ctx.data.identityVerificationDocumentKinds?.length
    ? ctx.data.identityVerificationDocumentKinds
    : requiredNonSelfieDocumentKinds(identityBasis)
  await sendText(ctx.phone, documentPrompt(documentKinds[0], identityBasis))

  return {
    nextStep: 'pj_identity_document',
    nextData: {
      identityVerificationId: verificationId,
      identityVerificationBasis: identityBasis,
      identityVerificationDocumentKinds: documentKinds,
    },
  }
}

async function handleIdentityDocument(ctx: FlowContext): Promise<FlowResult> {
  const verificationId = ctx.data.identityVerificationId
  const identityBasis = ctx.data.identityVerificationBasis ?? 'SA_ID'
  const pendingDocumentKinds = ctx.data.identityVerificationDocumentKinds?.length
    ? ctx.data.identityVerificationDocumentKinds
    : requiredNonSelfieDocumentKinds(identityBasis)
  const documentKind = pendingDocumentKinds[0]
  const mediaId = ctx.reply.mediaId

  if (!verificationId || !documentKind) {
    await sendText(ctx.phone, 'We could not find your verification session. Please start identity verification again from the provider menu.')
    return { nextStep: 'done', nextData: {} }
  }
  if (!mediaId || !['image', 'document'].includes(ctx.reply.type)) {
    if (isContinueReply(ctx) && verificationId && documentKind) {
      const existingDocument = await findStoredIdentityDocument(verificationId, documentKind)
      if (existingDocument) {
        return continueAfterIdentityDocumentStored({
          ctx,
          verificationId,
          identityBasis,
          pendingDocumentKinds,
          documentKind,
          documentId: existingDocument.id,
        })
      }
    }
    await sendText(ctx.phone, documentPrompt(documentKind, identityBasis))
    return {
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationId: verificationId,
        identityVerificationBasis: identityBasis,
        identityVerificationDocumentKinds: pendingDocumentKinds,
      },
    }
  }

  let storedDocument: { documentId: string }
  try {
    // This is where a transient WhatsApp media ID becomes a private identity
    // document record. On failure, keep the same step so the next upload can
    // retry without exposing or logging the source media.
    storedDocument = await downloadAndStoreWhatsAppIdentityDocument({
      mediaId,
      verificationId,
      documentKind,
      maxSizeBytes: IDENTITY_WHATSAPP_MEDIA_MAX_BYTES,
    })
  } catch (error) {
    const classified = toIdentityDocumentMediaError(error, {
      code: 'DOCUMENT_STORAGE_UPLOAD_FAILED',
      operation: 'document_storage_upload',
      message: 'Identity document media storage failed',
      verificationId,
      documentKind,
      mediaIdSuffix: safeMediaIdSuffix(mediaId),
      mimeType: ctx.reply.mimeType,
      maxSizeBytes: IDENTITY_WHATSAPP_MEDIA_MAX_BYTES,
      storageProvider: 'vercel_blob',
      storageBucketName: 'identity',
    })
    console.warn(
      '[identity-verification:whatsapp] document media storage failed',
      {
        ...safeIdentityDocumentMediaErrorLog(classified, {
          verificationId,
          documentKind,
          mediaIdSuffix: safeMediaIdSuffix(mediaId),
          mimeType: ctx.reply.mimeType,
          maxSizeBytes: IDENTITY_WHATSAPP_MEDIA_MAX_BYTES,
          storageProvider: 'vercel_blob',
          storageBucketName: 'identity',
        }),
        reason: identityMediaFailureReason(classified),
      },
    )
    await sendText(ctx.phone, "We couldn't save that document photo right now. Please send a clear image or PDF again.")
    return {
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationId: verificationId,
        identityVerificationBasis: identityBasis,
        identityVerificationDocumentKinds: pendingDocumentKinds,
      },
    }
  }

  return continueAfterIdentityDocumentStored({
    ctx,
    verificationId,
    identityBasis,
    pendingDocumentKinds,
    documentKind,
    documentId: storedDocument.documentId,
  })
}

async function continueAfterIdentityDocumentStored(params: {
  ctx: FlowContext
  verificationId: string
  identityBasis: IdentityBasis
  pendingDocumentKinds: IdentityDocumentKind[]
  documentKind: IdentityDocumentKind
  documentId: string
}): Promise<FlowResult> {
  const { ctx, verificationId, identityBasis, pendingDocumentKinds, documentKind, documentId } = params
  const remaining = pendingDocumentKinds.slice(1)
  if (remaining.length > 0) {
    await sendText(ctx.phone, documentPrompt(remaining[0], identityBasis))
    return {
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationId: verificationId,
        identityVerificationBasis: identityBasis,
        identityVerificationDocumentKinds: remaining,
        identityVerificationDocumentIds: [
          ...(ctx.data.identityVerificationDocumentIds ?? []),
          documentId,
        ],
      },
    }
  }

  try {
    const current = await db.providerIdentityVerification.findUnique({
      where: { id: verificationId },
      select: { status: true },
    })
    if (!current || current.status === 'AWAITING_DOCUMENT') {
      await transitionIdentityVerification({
        verificationId,
        toStatus: 'AWAITING_SELFIE',
        metadata: { channel: 'whatsapp', identityBasis },
      })
    }
  } catch (error) {
    const classified = new IdentityDocumentMediaError({
      code: 'VERIFICATION_STATE_UPDATE_FAILED',
      operation: 'verification_state_update',
      message: 'Identity verification state update failed after document save',
      cause: error,
      verificationId,
      documentKind,
    })
    console.error(
      '[identity-verification:whatsapp] verification state update failed',
      safeIdentityDocumentMediaErrorLog(classified, { verificationId, documentKind }),
    )
    await sendText(ctx.phone, "We saved your document, but couldn't move to the next step right now. Reply Continue to keep going.")
    return {
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationId: verificationId,
        identityVerificationBasis: identityBasis,
        identityVerificationDocumentKinds: pendingDocumentKinds,
        identityVerificationDocumentIds: [
          ...(ctx.data.identityVerificationDocumentIds ?? []),
          documentId,
        ],
      },
    }
  }
  await sendText(ctx.phone, 'Now send a clear selfie photo of your face. This WhatsApp option is reviewed manually and may still require a secure PWA liveness step before buying credits.')

  return {
    nextStep: 'pj_identity_selfie',
    nextData: {
      identityVerificationId: verificationId,
      identityVerificationBasis: identityBasis,
      identityVerificationDocumentIds: [
        ...(ctx.data.identityVerificationDocumentIds ?? []),
        documentId,
      ],
    },
  }
}

async function resolveConsentVendorForWhatsApp(
  verificationId: string,
  ctx: FlowContext,
): Promise<{ vendorKey: string; vendorDisplayName: string; consentText: string }> {
  const vendorKey = typeof ctx.data.identityConsentVendorKey === 'string'
    ? ctx.data.identityConsentVendorKey
    : null
  const vendorDisplayName = typeof ctx.data.identityConsentVendorDisplayName === 'string'
    ? ctx.data.identityConsentVendorDisplayName
    : null
  const consentText = typeof ctx.data.identityConsentText === 'string'
    ? ctx.data.identityConsentText
    : null

  if (vendorKey && vendorDisplayName && consentText) {
    return { vendorKey, vendorDisplayName, consentText }
  }

  const consentVendor = await resolveIdentityVerificationConsentVendor(verificationId)
  return {
    vendorKey: consentVendor.vendorKey,
    vendorDisplayName: consentVendor.vendorDisplayName,
    consentText: renderIdentityConsentText(consentVendor.vendorDisplayName),
  }
}

async function findStoredIdentityDocument(
  verificationId: string,
  documentKind: IdentityDocumentKind,
): Promise<{ id: string } | null> {
  try {
    return await db.providerIdentityDocument.findFirst({
      where: { verificationId, documentKind },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })
  } catch (error) {
    console.warn('[identity-verification:whatsapp] stored document lookup failed', {
      code: 'VERIFICATION_DOCUMENT_DB_WRITE_FAILED',
      failedOperationName: 'verification_document_db_write',
      verificationId,
      documentKind,
      reason: error instanceof Error ? error.name : 'unknown',
    })
    return null
  }
}

function isContinueReply(ctx: FlowContext): boolean {
  if (ctx.reply.type === 'button_reply' && ctx.reply.id?.toLowerCase().includes('continue')) return true
  return ctx.reply.type === 'text' && ctx.reply.text?.trim().toLowerCase() === 'continue'
}

async function handleIdentitySelfie(ctx: FlowContext): Promise<FlowResult> {
  const verificationId = ctx.data.identityVerificationId
  const mediaId = ctx.reply.mediaId
  if (!verificationId) {
    await sendText(ctx.phone, 'We could not find your verification session. Please start identity verification again from the provider menu.')
    return { nextStep: 'done', nextData: {} }
  }
  if (!mediaId || ctx.reply.type !== 'image') {
    await sendText(ctx.phone, 'Please send a clear selfie photo of your face to submit this for manual review.')
    return {
      nextStep: 'pj_identity_selfie',
      nextData: {
        identityVerificationId: verificationId,
        identityVerificationBasis: ctx.data.identityVerificationBasis,
      },
    }
  }

  try {
    // Selfies are stored as private identity documents too. Retry in-place on
    // storage/download failure so duplicate or expired media does not corrupt state.
    await downloadAndStoreWhatsAppIdentityDocument({
      mediaId,
      verificationId,
      documentKind: 'SELFIE',
      maxSizeBytes: IDENTITY_WHATSAPP_MEDIA_MAX_BYTES,
    })
  } catch (error) {
    console.warn('[identity-verification:whatsapp] selfie media storage failed', {
      verificationId,
      documentKind: 'SELFIE',
      mediaIdSuffix: mediaId.slice(-8),
      reason: identityMediaFailureReason(error),
    })
    await sendText(ctx.phone, "We couldn't save that selfie photo right now. Please send a clear selfie image again.")
    return {
      nextStep: 'pj_identity_selfie',
      nextData: {
        identityVerificationId: verificationId,
        identityVerificationBasis: ctx.data.identityVerificationBasis,
      },
    }
  }
  await transitionIdentityVerification({
    verificationId,
    toStatus: 'SUBMITTED',
    metadata: { submittedFrom: 'whatsapp' },
  })
  const automation = await submitVerificationForAutomation(verificationId)
  await sendAutomationOutcome(ctx.phone, automation)

  return { nextStep: 'done', nextData: {} }
}

async function sendAutomationOutcome(
  phone: string,
  automation: Awaited<ReturnType<typeof submitVerificationForAutomation>>,
) {
  // Terminal statuses (PASSED / NEEDS_MANUAL_REVIEW / FAILED) are notified
  // centrally by transitionIdentityVerification, so this helper only handles
  // the in-flight statuses the WhatsApp flow needs to surface directly.
  if (automation.status === 'AWAITING_LIVENESS' && automation.livenessUrl) {
    await sendText(
      phone,
      `One more step - tap this secure link to complete a quick face-match: ${automation.livenessUrl}. The link expires when your face-match session does.`,
    )
    return
  }
  if (automation.status === 'PROCESSING') {
    await sendText(phone, "Thanks, we're verifying your details now - I'll message you the moment it's done.")
    return
  }
}

function identityMediaFailureReason(error: unknown) {
  if (error instanceof IdentityDocumentMediaError) return error.code
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Unsupported media type')) return 'unsupported_media_type'
  if (message.includes('File too large')) return 'file_too_large'
  if (message.includes('metadata fetch failed')) return 'metadata_fetch_failed'
  if (message.includes('media download failed')) return 'download_failed'
  if (message.includes('empty file')) return 'empty_file'
  if (message.includes('Missing WHATSAPP_ACCESS_TOKEN')) return 'missing_whatsapp_access_token'
  return 'storage_failed'
}

async function sendIdentityBasisList(phone: string) {
  await sendList(
    phone,
    'Which document will you use for identity verification?',
    [
      {
        title: 'Identity type',
        rows: IDENTITY_BASIS_ROWS.map((row) => ({
          id: `iv_basis_${row.basis}`,
          title: row.title,
          description: row.description,
        })),
      },
    ],
    { buttonLabel: 'Choose document' },
  )
}

async function findProviderForIdentity(phone: string) {
  const normalizedPhone = normalizePhone(phone)
  const exact = await db.provider.findUnique({
    where: { phone: normalizedPhone },
    select: { id: true, phone: true, kycStatus: true },
  })
  if (exact) return exact

  const matches = await db.provider.findMany({
    where: { phone: { in: phoneLookupVariants(phone) } },
    select: { id: true, phone: true, kycStatus: true },
    take: 3,
  })
  if (matches.length > 1) {
    console.warn('[identity-verification:whatsapp] duplicate provider phone records detected', {
      phoneSuffix: normalizedPhone.slice(-4),
      providerIds: matches.map((provider) => provider.id),
    })
  }

  return matches[0] ?? null
}

function parseIdentityBasis(replyId?: string): IdentityBasis | null {
  if (!replyId?.startsWith('iv_basis_')) return null
  const basis = replyId.replace('iv_basis_', '') as IdentityBasis
  return IDENTITY_BASIS_ROWS.some((row) => row.basis === basis) ? basis : null
}

function requiredNonSelfieDocumentKinds(identityBasis: IdentityBasis): IdentityDocumentKind[] {
  return getRequiredDocumentKinds(identityBasis).filter((kind) => kind !== 'SELFIE')
}

function validateIdentifierForBasis(identityBasis: IdentityBasis, raw: string):
  | { ok: true; normalized: string; saId?: Extract<ReturnType<typeof validateSaId>, { ok: true }> }
  | { ok: false } {
  if (identityBasis === 'SA_ID') {
    const validation = validateSaId(raw)
    if (!validation.ok) return { ok: false }
    return { ok: true, normalized: validation.normalized, saId: validation }
  }

  if (['PASSPORT', 'WORK_PERMIT', 'PERMANENT_RESIDENCE_PERMIT'].includes(identityBasis)) {
    const validation = validatePassportNumber(raw)
    if (!validation.ok) return { ok: false }
    return { ok: true, normalized: validation.normalized }
  }

  const normalized = normalizeIdentifier(raw)
  if (normalized.length >= 4 && normalized.length <= 80 && /^[A-Z0-9/-]+$/.test(normalized)) {
    return { ok: true, normalized }
  }

  return { ok: false }
}

function identifierPrompt(identityBasis: IdentityBasis): string {
  switch (identityBasis) {
    case 'SA_ID':
      return 'Please type your 13-digit South African ID number. We will store a protected hash and last 4 digits only.'
    case 'PASSPORT':
      return 'Please type your passport number exactly as shown on the photo page.'
    case 'REFUGEE_ID':
      return 'Please type the number shown on your refugee ID document.'
    case 'ASYLUM_PERMIT':
      return 'Please type the permit number on your Section 22 asylum seeker permit.'
    case 'REFUGEE_PERMIT':
      return 'Please type the permit number on your Section 24 refugee permit.'
    case 'WORK_PERMIT':
      return 'Please type your passport number. We will ask for the work permit document next.'
    case 'PERMANENT_RESIDENCE_PERMIT':
      return 'Please type your passport number. We will ask for residence proof next.'
  }
}

function invalidIdentifierMessage(identityBasis: IdentityBasis): string {
  switch (identityBasis) {
    case 'SA_ID':
      return 'That South African ID number does not look valid. Please check the 13 digits and send it again.'
    case 'PASSPORT':
    case 'WORK_PERMIT':
    case 'PERMANENT_RESIDENCE_PERMIT':
      return 'That passport number does not look valid. Please send 6 to 30 letters/numbers with no spaces.'
    default:
      return 'That document number does not look valid. Please send the number exactly as shown on the document.'
  }
}

function documentPrompt(documentKind: IdentityDocumentKind, identityBasis: IdentityBasis): string {
  switch (documentKind) {
    case 'ID_FRONT':
      return 'Please send a clear photo of your South African ID card front or the photo page of your green ID book.'
    case 'ID_BACK':
      return 'Please send a clear photo of the back of your South African smart ID card.'
    case 'GREEN_ID_BOOK':
      return 'Please send a clear photo of the photo page in your green ID book.'
    case 'PASSPORT_PHOTO_PAGE':
      return identityBasis === 'WORK_PERMIT' || identityBasis === 'PERMANENT_RESIDENCE_PERMIT'
        ? 'Please send a clear photo of your passport photo page.'
        : 'Please send a clear photo of your passport photo page, including the document number and expiry date.'
    case 'VISA':
      return 'Please send a clear photo of your visa or permanent residence proof.'
    case 'WORK_PERMIT':
      return 'Please send a clear photo of your valid work permit.'
    case 'ASYLUM_SEEKER_PERMIT_SECTION_22':
      return 'Please send a clear photo of your Section 22 asylum seeker permit.'
    case 'REFUGEE_PERMIT_SECTION_24':
      return 'Please send a clear photo of your Section 24 refugee permit.'
    case 'REFUGEE_ID':
      return 'Please send a clear photo of your refugee ID document.'
    case 'SELFIE':
    case 'LIVENESS_FRAME':
      return 'Please send a clear selfie photo of your face.'
  }
}
