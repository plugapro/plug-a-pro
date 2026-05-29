import type { Prisma, SecurityEventType, SecuritySeverity, SecuritySourceChannel } from '@prisma/client'
import { db } from '@/lib/db'
import {
  sanitizeSecurityReviewMetadata,
  type SanitizedSecurityReviewMetadata,
} from './security-event-metadata-schema'

type SecurityEventClient = {
  providerIdentityVerification: {
    findUnique(args: {
      where: { id: string }
      select: {
        id: true
        provider: { select: { phone: true } }
        providerApplication: { select: { phone: true } }
      }
    }): Promise<{
      id: string
      provider: { phone: string } | null
      providerApplication: { phone: string } | null
    } | null>
  }
  securityEvent: {
    create(args: { data: Prisma.SecurityEventUncheckedCreateInput }): Promise<unknown>
  }
}

export type RaiseSecurityReviewEventInput = {
  eventType: SecurityEventType
  severity: SecuritySeverity
  sourceChannel?: SecuritySourceChannel
  userId?: string | null
  phoneE164?: string | null
  subjectVerificationId?: string | null
  subjectWebhookEventId?: string | null
  metadata?: SanitizedSecurityReviewMetadata | Record<string, unknown>
}

export async function raiseSecurityReviewEvent(
  input: RaiseSecurityReviewEventInput,
  client: SecurityEventClient = db,
): Promise<void> {
  if (!input.phoneE164 && !input.subjectVerificationId && !input.subjectWebhookEventId) {
    throw new Error('Security event requires a subject: phoneE164, subjectVerificationId or subjectWebhookEventId')
  }

  const metadata = sanitizeSecurityReviewMetadata(input.metadata)
  const phoneE164 = input.phoneE164 ?? await derivePhoneFromVerification(input.subjectVerificationId, client)

  await client.securityEvent.create({
    data: {
      userId: input.userId ?? null,
      phoneE164: phoneE164 ?? null,
      subjectVerificationId: input.subjectVerificationId ?? null,
      subjectWebhookEventId: input.subjectWebhookEventId ?? null,
      eventType: input.eventType,
      severity: input.severity,
      sourceChannel: input.sourceChannel ?? 'SYSTEM',
      metadata,
    },
  })
}

async function derivePhoneFromVerification(
  subjectVerificationId: string | null | undefined,
  client: SecurityEventClient,
): Promise<string | null> {
  if (!subjectVerificationId) return null

  const verification = await client.providerIdentityVerification.findUnique({
    where: { id: subjectVerificationId },
    select: {
      id: true,
      provider: { select: { phone: true } },
      providerApplication: { select: { phone: true } },
    },
  })

  return verification?.provider?.phone ?? verification?.providerApplication?.phone ?? null
}
