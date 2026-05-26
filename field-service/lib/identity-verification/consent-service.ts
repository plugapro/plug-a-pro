import { createHash } from 'crypto'
import type { Prisma, VerificationChannel } from '@prisma/client'
import { db } from '@/lib/db'

type ConsentClient = {
  providerIdentityConsentEvent: {
    create(args: { data: Prisma.ProviderIdentityConsentEventUncheckedCreateInput }): Promise<unknown>
  }
  providerIdentityVerification: {
    update(args: { where: { id: string }; data: Prisma.ProviderIdentityVerificationUpdateInput }): Promise<unknown>
  }
}

export type RecordConsentAcceptanceInput = {
  verificationId: string
  vendorKey: string
  vendorDisplayName: string
  consentText: string
  consentTextVersion?: string
  channel: VerificationChannel
  acceptedByProviderId?: string | null
  acceptedByApplicationId?: string | null
  metadata?: Prisma.InputJsonValue
  acceptedAt?: Date
}

export async function recordConsentAcceptance(
  input: RecordConsentAcceptanceInput,
  client: ConsentClient = db,
): Promise<{ consentTextHash: string }> {
  const acceptedAt = input.acceptedAt ?? new Date()
  const consentTextHash = hashConsentText(input.consentText)

  await client.providerIdentityConsentEvent.create({
    data: {
      verificationId: input.verificationId,
      vendorKey: input.vendorKey,
      vendorDisplayName: input.vendorDisplayName,
      consentTextHash,
      consentTextVersion: input.consentTextVersion ?? 'v1',
      channel: input.channel,
      acceptedAt,
      acceptedByProviderId: input.acceptedByProviderId ?? null,
      acceptedByApplicationId: input.acceptedByApplicationId ?? null,
      metadata: input.metadata ?? undefined,
    },
  })

  await client.providerIdentityVerification.update({
    where: { id: input.verificationId },
    data: {
      consentAcceptedAt: acceptedAt,
      consentVendorKey: input.vendorKey,
      consentVendorDisplayName: input.vendorDisplayName,
      consentTextHash,
    },
  })

  return { consentTextHash }
}

export function renderIdentityConsentText(vendorDisplayName: string): string {
  return [
    'To verify your identity, Plug A Pro shares your ID number, photographs, and selfie',
    `with ${vendorDisplayName}, an identity-verification provider.`,
    'You can withdraw consent by contacting support; withdrawal cancels your verification.',
  ].join(' ')
}

export function hashConsentText(consentText: string): string {
  return createHash('sha256').update(consentText.trim()).digest('hex')
}
