import { createHmac, timingSafeEqual } from 'crypto'
import { db } from './db'
import { previewNotes } from './provider-lead-detail'

const TOKEN_TTL_MS = 72 * 60 * 60 * 1000

type ProviderLeadTokenPayload = {
  v: 1
  leadId: string
  providerId: string
  exp: number
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url')
}

function getSigningSecret() {
  const secret =
    process.env.PROVIDER_LEAD_ACCESS_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.WHATSAPP_APP_SECRET ||
    process.env.CRON_SECRET

  if (!secret) {
    throw new Error('Missing PROVIDER_LEAD_ACCESS_SECRET or fallback signing secret')
  }

  return secret
}

function signPayload(encodedPayload: string) {
  return createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url')
}

function parsePayload(encodedPayload: string): ProviderLeadTokenPayload | null {
  try {
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as Partial<ProviderLeadTokenPayload>
    if (
      parsed.v !== 1 ||
      typeof parsed.leadId !== 'string' ||
      typeof parsed.providerId !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    return parsed as ProviderLeadTokenPayload
  } catch {
    return null
  }
}

function getProviderLeadBaseUrl() {
  return (
    process.env.PROVIDER_LEAD_APP_URL ||
    process.env.NEXT_PUBLIC_PROVIDER_LEAD_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ''
  ).trim().replace(/\/+$/, '')
}

export function createProviderLeadAccessToken(params: {
  leadId: string
  providerId: string
  expiresAt?: Date
}) {
  const exp = Math.floor((params.expiresAt?.getTime() ?? Date.now() + TOKEN_TTL_MS) / 1000)
  const payload: ProviderLeadTokenPayload = {
    v: 1,
    leadId: params.leadId,
    providerId: params.providerId,
    exp,
  }
  const encodedPayload = base64url(JSON.stringify(payload))
  const signature = signPayload(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function verifyProviderLeadAccessToken(token: string) {
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return { status: 'invalid' as const, payload: null }

  const expected = signPayload(encodedPayload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return { status: 'invalid' as const, payload: null }
  }

  const payload = parsePayload(encodedPayload)
  if (!payload) return { status: 'invalid' as const, payload: null }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { status: 'expired' as const, payload }
  }

  return { status: 'active' as const, payload }
}

export async function getProviderLeadAccessUrl(params: {
  leadId: string
  providerId: string
  expiresAt?: Date
}) {
  const appUrl = getProviderLeadBaseUrl()
  if (!appUrl) return null

  const token = createProviderLeadAccessToken(params)
  return `${appUrl}/leads/access/${encodeURIComponent(token)}`
}

export async function getProviderLeadAccessUrlByLeadId(leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, providerId: true },
  })

  if (!lead) return null
  return getProviderLeadAccessUrl({ leadId: lead.id, providerId: lead.providerId })
}

export async function resolveProviderLeadAccessToken(token: string) {
  const verified = verifyProviderLeadAccessToken(token)
  if (verified.status !== 'active') {
    return { status: verified.status, lead: null, payload: verified.payload }
  }

  const lead = await db.lead.findUnique({
    where: { id: verified.payload.leadId },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
      status: true,
      sentAt: true,
      expiresAt: true,
      provider: { select: { id: true, name: true, phone: true } },
      unlock: true,
      jobRequest: {
        select: {
          id: true,
          category: true,
          title: true,
          description: true,
          requestedWindowStart: true,
          requestedWindowEnd: true,
          requestedArrivalLatest: true,
          customerAcceptedAmount: true,
          address: {
            select: {
              suburb: true,
              city: true,
            },
          },
          match: {
            select: {
              id: true,
              status: true,
              customerContactedAt: true,
              plannedArrivalStart: true,
              plannedArrivalEnd: true,
              plannedArrivalNote: true,
              providerOnTheWayAt: true,
              providerArrivedAt: true,
              providerStartedAt: true,
              providerCompletedAt: true,
            },
          },
        },
      },
    },
  })

  if (!lead || lead.providerId !== verified.payload.providerId) {
    return { status: 'invalid' as const, lead: null, payload: verified.payload }
  }

  const scopedLead = {
    ...lead,
    jobRequest: {
      ...lead.jobRequest,
      description: lead.unlock
        ? lead.jobRequest.description
        : previewNotes(lead.jobRequest.description) ?? '',
      customer: null as { id: string; name: string; phone: string } | null,
      attachments: [] as Array<{ id: string; caption: string | null; label: string | null }>,
    },
  }

  if (lead.unlock) {
    const sensitiveLead = await db.lead.findUnique({
      where: { id: lead.id },
      select: {
        jobRequest: {
          select: {
            customer: { select: { id: true, name: true, phone: true } },
            address: {
              select: {
                street: true,
                addressLine1: true,
                addressLine2: true,
                complexName: true,
                unitNumber: true,
                suburb: true,
                city: true,
                province: true,
              },
            },
            attachments: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                caption: true,
                label: true,
              },
            },
          },
        },
      },
    })

    if (sensitiveLead) {
      scopedLead.jobRequest.customer = sensitiveLead.jobRequest.customer
      scopedLead.jobRequest.address = sensitiveLead.jobRequest.address
      scopedLead.jobRequest.attachments = sensitiveLead.jobRequest.attachments
    }
  }

  return { status: 'active' as const, lead: scopedLead, payload: verified.payload }
}

export async function resolveProviderLeadAttachmentScope(token: string) {
  const resolved = await resolveProviderLeadAccessToken(token)
  if (resolved.status !== 'active' || !resolved.lead) {
    return { status: resolved.status, jobRequestId: null, leadId: resolved.payload?.leadId ?? null }
  }

  if (!resolved.lead.unlock) {
    return {
      status: 'locked' as const,
      jobRequestId: null,
      leadId: resolved.lead.id,
    }
  }

  return {
    status: 'active' as const,
    jobRequestId: resolved.lead.jobRequestId,
    leadId: resolved.lead.id,
  }
}
