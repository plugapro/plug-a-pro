import { createHmac, timingSafeEqual } from 'crypto'
import { db } from './db'

const CUSTOMER_HANDOVER_TTL_MS = 14 * 24 * 60 * 60 * 1000

type CustomerProviderHandoverPayload = {
  v: 1
  leadId: string
  providerId: string
  jobRequestId: string
  exp: number
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url')
}

function getSigningSecret() {
  const secret =
    process.env.CUSTOMER_HANDOVER_ACCESS_SECRET ||
    process.env.PROVIDER_LEAD_ACCESS_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.WHATSAPP_APP_SECRET ||
    process.env.CRON_SECRET

  if (!secret) {
    throw new Error('Missing CUSTOMER_HANDOVER_ACCESS_SECRET or fallback signing secret')
  }

  return secret
}

function signPayload(encodedPayload: string) {
  return createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url')
}

function parsePayload(encodedPayload: string): CustomerProviderHandoverPayload | null {
  try {
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as Partial<CustomerProviderHandoverPayload>
    if (
      parsed.v !== 1 ||
      typeof parsed.leadId !== 'string' ||
      typeof parsed.providerId !== 'string' ||
      typeof parsed.jobRequestId !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    return parsed as CustomerProviderHandoverPayload
  } catch {
    return null
  }
}

function getAppBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '')
}

export function createCustomerProviderHandoverToken(params: {
  leadId: string
  providerId: string
  jobRequestId: string
  expiresAt?: Date
}) {
  const exp = Math.floor((params.expiresAt?.getTime() ?? Date.now() + CUSTOMER_HANDOVER_TTL_MS) / 1000)
  const payload: CustomerProviderHandoverPayload = {
    v: 1,
    leadId: params.leadId,
    providerId: params.providerId,
    jobRequestId: params.jobRequestId,
    exp,
  }
  const encodedPayload = base64url(JSON.stringify(payload))
  return `${encodedPayload}.${signPayload(encodedPayload)}`
}

export function verifyCustomerProviderHandoverToken(token: string) {
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

export async function getCustomerProviderHandoverUrl(params: {
  leadId: string
  providerId: string
  jobRequestId: string
  expiresAt?: Date
}) {
  const appUrl = getAppBaseUrl()
  if (!appUrl) return null

  const token = createCustomerProviderHandoverToken(params)
  return `${appUrl}/customer/requests/${encodeURIComponent(params.jobRequestId)}/provider-handover?token=${encodeURIComponent(token)}`
}

export async function resolveCustomerProviderHandoverToken(token: string) {
  const verified = verifyCustomerProviderHandoverToken(token)
  if (verified.status !== 'active') {
    return { status: verified.status, payload: verified.payload, handover: null }
  }

  const payload = verified.payload
  const lead = await db.lead.findUnique({
    where: { id: payload.leadId },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
      status: true,
      jobRequest: {
        select: {
          id: true,
          status: true,
          category: true,
          title: true,
          description: true,
          customerAccessToken: true,
          customerAccessTokenExpiresAt: true,
          customerAccessTokenRevokedAt: true,
          customer: { select: { id: true, name: true } },
          address: {
            select: {
              suburb: true,
              city: true,
              province: true,
            },
          },
          attachments: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, caption: true, label: true },
          },
          match: {
            select: {
              id: true,
              providerId: true,
              status: true,
              createdAt: true,
              provider: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  bio: true,
                  experience: true,
                  skills: true,
                  serviceAreas: true,
                  evidenceNote: true,
                  avatarUrl: true,
                  verified: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (
    !lead ||
    lead.id !== payload.leadId ||
    lead.providerId !== payload.providerId ||
    lead.jobRequestId !== payload.jobRequestId ||
    lead.status !== 'ACCEPTED' ||
    lead.jobRequest.status === 'CANCELLED' ||
    lead.jobRequest.status === 'EXPIRED' ||
    !lead.jobRequest.match ||
    lead.jobRequest.match.status === 'CANCELLED' ||
    lead.jobRequest.match.providerId !== payload.providerId
  ) {
    return { status: 'invalid' as const, payload, handover: null }
  }

  return {
    status: 'active' as const,
    payload,
    handover: {
      leadId: lead.id,
      jobRequest: lead.jobRequest,
      match: lead.jobRequest.match,
    },
  }
}
