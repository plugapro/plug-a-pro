import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { db } from './db'
import { checkPhaseOneLeadDetailEligibility } from './provider-lead-eligibility'
import { previewNotes } from './provider-lead-detail'
import { getProviderLeadPublicAppUrl } from './provider-credit-copy'
import { maskPhone } from './support-diagnostics'

const TOKEN_TTL_MS = 72 * 60 * 60 * 1000
const DEFAULT_LEAD_UNLOCK_COST_CREDITS = 1

export const PROVIDER_LEAD_SCOPES = [
  'view_lead',
  'unlock_lead',
  'accept_lead',
  'decline_lead',
  'view_job',
  'confirm_arrival',
  'mark_customer_contacted',
  'mark_on_the_way',
  'mark_arrived',
  'start_job',
  'complete_job',
  'contact_customer',
] as const

export type ProviderLeadAccessScope = typeof PROVIDER_LEAD_SCOPES[number]

export const LEAD_RESPONSE_SCOPES: ProviderLeadAccessScope[] = [
  'view_lead',
  'accept_lead',
  'decline_lead',
]

export const ACCEPTED_JOB_SCOPES: ProviderLeadAccessScope[] = [
  'view_job',
  'confirm_arrival',
  'mark_customer_contacted',
  'mark_on_the_way',
  'mark_arrived',
  'start_job',
  'complete_job',
  'contact_customer',
]

const JOB_HANDOVER_ELIGIBLE_LEAD_STATUSES = [
  'CUSTOMER_SELECTED',
  'PROVIDER_ACCEPTED',
  'CREDIT_REQUIRED',
  'CREDIT_APPLIED',
  'ACCEPTED',
  'ACCEPTED_LOCKED',
] as const

type ProviderLeadTokenPayload = {
  v: 1
  leadId: string
  providerId: string
  jobRequestId?: string
  providerPhoneHash?: string
  scopes?: ProviderLeadAccessScope[]
  jti?: string
  exp: number
}

type CreateProviderLeadAccessTokenParams = {
  leadId: string
  providerId: string
  jobRequestId?: string
  providerPhone?: string | null
  scopes?: ProviderLeadAccessScope[]
  expiresAt?: Date
  allowLegacyMissingScopes?: boolean
}

type ProviderLeadAccessTokenIssue = {
  token: string
  payload: ProviderLeadTokenPayload
}

type ProviderLeadAccessInvalidReason =
  | 'SIGNING_SECRET_MISSING'
  | 'LEAD_NOT_FOUND'
  | 'PROVIDER_NOT_ACTIVE'
  | 'PROVIDER_NOT_APPROVED'
  | 'PROVIDER_MISMATCH'
  | 'JOB_REQUEST_MISMATCH'
  | 'PROVIDER_PHONE_MISMATCH'
  | 'SENDER_PHONE_MISMATCH'
  | 'MATCH_CANCELLED'

const SAFE_LEAD_UNLOCK_SELECT = {
  id: true,
  providerId: true,
  unlockedAt: true,
} as const

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url')
}

function getSigningSecret() {
  const secret =
    process.env.PROVIDER_LEAD_ACCESS_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET

  if (!secret) {
    throw new Error('Missing PROVIDER_LEAD_ACCESS_SECRET, NEXTAUTH_SECRET or AUTH_SECRET')
  }

  return secret
}

function signPayload(encodedPayload: string) {
  return createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url')
}

function resolveIssuedScopes(params: Pick<CreateProviderLeadAccessTokenParams, 'scopes' | 'allowLegacyMissingScopes'>) {
  if (params.allowLegacyMissingScopes) return params.scopes
  if (!params.scopes) return [...LEAD_RESPONSE_SCOPES]
  if (params.scopes.length === 0) {
    throw new Error('Provider lead access tokens require at least one explicit scope')
  }
  return [...params.scopes]
}

function parsePayload(encodedPayload: string): ProviderLeadTokenPayload | null {
  try {
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as Partial<ProviderLeadTokenPayload>
    if (
      parsed.v !== 1 ||
      typeof parsed.leadId !== 'string' ||
      typeof parsed.providerId !== 'string' ||
      typeof parsed.exp !== 'number' ||
      (parsed.jobRequestId != null && typeof parsed.jobRequestId !== 'string') ||
      (parsed.providerPhoneHash != null && typeof parsed.providerPhoneHash !== 'string') ||
      (parsed.jti != null && typeof parsed.jti !== 'string') ||
      (parsed.scopes != null && (
        !Array.isArray(parsed.scopes) ||
        !parsed.scopes.every((scope) => typeof scope === 'string' && PROVIDER_LEAD_SCOPES.includes(scope as ProviderLeadAccessScope))
      ))
    ) {
      return null
    }
    return parsed as ProviderLeadTokenPayload
  } catch {
    return null
  }
}

function createProviderLeadAccessTokenIssue(params: CreateProviderLeadAccessTokenParams): ProviderLeadAccessTokenIssue {
  const exp = Math.floor((params.expiresAt?.getTime() ?? Date.now() + TOKEN_TTL_MS) / 1000)
  const payload: ProviderLeadTokenPayload = {
    v: 1,
    leadId: params.leadId,
    providerId: params.providerId,
    jobRequestId: params.jobRequestId,
    providerPhoneHash: params.providerPhone ? hashProviderPhone(params.providerPhone) : undefined,
    scopes: resolveIssuedScopes(params),
    jti: randomUUID(),
    exp,
  }
  const encodedPayload = base64url(JSON.stringify(payload))
  const signature = signPayload(encodedPayload)
  return { token: `${encodedPayload}.${signature}`, payload }
}

export function createProviderLeadAccessToken(params: CreateProviderLeadAccessTokenParams) {
  return createProviderLeadAccessTokenIssue(params).token
}

export function verifyProviderLeadAccessToken(token: string) {
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return { status: 'invalid' as const, payload: null }

  let expected: string
  try {
    expected = signPayload(encodedPayload)
  } catch (error) {
    console.error('[provider-lead-access] signing secret missing while verifying token', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { status: 'invalid' as const, payload: null, reason: 'SIGNING_SECRET_MISSING' as const }
  }
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

export function hashSignedToken(token: string) {
  return createHash('sha256').update(token).digest('base64url').slice(0, 24)
}

export function hashProviderPhone(phone: string) {
  return createHash('sha256').update(phone.replace(/\D/g, '')).digest('base64url').slice(0, 24)
}

async function persistProviderLeadAccessTokenIssue(issue: ProviderLeadAccessTokenIssue) {
  if (!issue.payload.jti) {
    throw new Error('Provider lead access token issue is missing jti')
  }

  try {
    await db.providerLeadAccessToken.create({
      data: {
        jti: issue.payload.jti,
        tokenHash: hashSignedToken(issue.token),
        leadId: issue.payload.leadId,
        providerId: issue.payload.providerId,
        jobRequestId: issue.payload.jobRequestId,
        scopes: issue.payload.scopes ?? [],
        expiresAt: new Date(issue.payload.exp * 1000),
      },
    })
  } catch (error) {
    // Registry rows support audit/revocation rollout. During this phase, signed
    // links remain fail-open so transient registry writes do not drop live lead offers.
    console.error('[provider-lead-access] token registry persistence failed', {
      jti: issue.payload.jti,
      leadId: issue.payload.leadId,
      providerId: issue.payload.providerId,
      jobRequestId: issue.payload.jobRequestId,
      scopes: issue.payload.scopes ?? [],
      expiresAt: new Date(issue.payload.exp * 1000).toISOString(),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function providerLeadTokenAllowsScope(
  payload: ProviderLeadTokenPayload | null,
  scope: ProviderLeadAccessScope,
) {
  if (!payload) return false
  if (!payload.scopes?.length) return true
  return payload.scopes.includes(scope)
}

export async function getProviderLeadAccessUrl(params: {
  leadId: string
  providerId: string
  jobRequestId?: string
  providerPhone?: string | null
  scopes?: ProviderLeadAccessScope[]
  expiresAt?: Date
}) {
  const appUrl = getProviderLeadPublicAppUrl()
  if (!appUrl) return null

  const issue = createProviderLeadAccessTokenIssue({
    ...params,
    scopes: params.scopes ?? LEAD_RESPONSE_SCOPES,
  })
  await persistProviderLeadAccessTokenIssue(issue)
  return `${appUrl}/leads/access/${encodeURIComponent(issue.token)}`
}

export async function getProviderSignedJobHandoverUrl(params: {
  leadId: string
  providerId: string
  jobRequestId: string
  providerPhone?: string | null
  expiresAt?: Date
}) {
  const appUrl = getProviderLeadPublicAppUrl()
  if (!appUrl) return null

  const issue = createProviderLeadAccessTokenIssue({
    leadId: params.leadId,
    providerId: params.providerId,
    jobRequestId: params.jobRequestId,
    providerPhone: params.providerPhone,
    scopes: ACCEPTED_JOB_SCOPES,
    expiresAt: params.expiresAt,
  })
  await persistProviderLeadAccessTokenIssue(issue)
  return `${appUrl}/provider/jobs/${encodeURIComponent(params.jobRequestId)}/handover?token=${encodeURIComponent(issue.token)}`
}

export async function getProviderLeadAccessUrlByLeadId(leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, providerId: true, jobRequestId: true, provider: { select: { phone: true } } },
  })

  if (!lead) return null
  return getProviderLeadAccessUrl({
    leadId: lead.id,
    providerId: lead.providerId,
    jobRequestId: lead.jobRequestId,
    providerPhone: lead.provider.phone,
    scopes: LEAD_RESPONSE_SCOPES,
  })
}

export async function getProviderSignedJobHandoverUrlByLeadId(leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, providerId: true, jobRequestId: true, provider: { select: { phone: true } } },
  })

  if (!lead) return null
  return getProviderSignedJobHandoverUrl({
    leadId: lead.id,
    providerId: lead.providerId,
    jobRequestId: lead.jobRequestId,
    providerPhone: lead.provider.phone,
  })
}

export async function getProviderSignedJobHandoverUrlForJobRequest(params: {
  jobRequestId: string
  providerId: string
  providerPhone?: string | null
  expiresAt?: Date
}) {
  const lead = await db.lead.findFirst({
    where: {
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      status: {
        in: [...JOB_HANDOVER_ELIGIBLE_LEAD_STATUSES],
      },
    },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
      provider: { select: { phone: true } },
      providerAcceptedAt: true,
      customerSelectedAt: true,
      sentAt: true,
    },
    orderBy: [
      { providerAcceptedAt: 'desc' },
      { customerSelectedAt: 'desc' },
      { sentAt: 'desc' },
    ],
  })

  if (!lead) return null

  return getProviderSignedJobHandoverUrl({
    leadId: lead.id,
    providerId: lead.providerId,
    jobRequestId: lead.jobRequestId,
    providerPhone: params.providerPhone ?? lead.provider.phone,
    expiresAt: params.expiresAt,
  })
}

export async function resolveProviderLeadAccessToken(
  token: string,
  opts?: {
    /** When set, the token's providerPhoneHash (if present) is checked against this phone. */
    assertSenderPhone?: string
  },
) {
  const traceId = crypto.randomUUID().slice(0, 8)
  const verified = verifyProviderLeadAccessToken(token)
  if (verified.status !== 'active') {
    return {
      status: verified.status,
      lead: null,
      payload: verified.payload,
      traceId,
      reason: (verified as { reason?: ProviderLeadAccessInvalidReason }).reason ?? null,
    }
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
      provider: { select: { id: true, name: true, phone: true, active: true, verified: true, status: true } },
      jobRequest: {
        select: {
          id: true,
          category: true,
          assignmentMode: true,
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
              province: true,
              region: true,
            },
          },
          attachments: {
            where: { safeForPreview: true },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              caption: true,
              label: true,
            },
          },
          match: {
            select: {
              id: true,
              status: true,
              createdAt: true,
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

  if (!lead) {
    console.warn('[provider-lead-access] token invalid: lead not found', {
      traceId,
      providerId: verified.payload.providerId,
      leadId: verified.payload.leadId,
    })
    return {
      status: 'invalid' as const,
      lead: null,
      payload: verified.payload,
      traceId,
      reason: 'LEAD_NOT_FOUND' as const,
    }
  }

  if (lead.providerId !== verified.payload.providerId) {
    console.warn('[provider-lead-access] token invalid: provider mismatch', {
      traceId,
      providerId: verified.payload.providerId,
      leadProviderId: lead.providerId,
      leadId: lead.id,
    })
    return {
      status: 'invalid' as const,
      lead: null,
      payload: verified.payload,
      traceId,
      reason: 'PROVIDER_MISMATCH' as const,
    }
  }

  if (verified.payload.jobRequestId && lead.jobRequestId !== verified.payload.jobRequestId) {
    console.warn('[provider-lead-access] token invalid: job request mismatch', {
      traceId,
      providerId: verified.payload.providerId,
      tokenJobRequestId: verified.payload.jobRequestId,
      leadJobRequestId: lead.jobRequestId,
      leadId: lead.id,
    })
    return {
      status: 'invalid' as const,
      lead: null,
      payload: verified.payload,
      traceId,
      reason: 'JOB_REQUEST_MISMATCH' as const,
    }
  }

  const eligibility = checkPhaseOneLeadDetailEligibility(lead.provider)
  if (!eligibility.ok) {
    console.warn('[provider-lead-access] token invalid: scope mismatch or inactive provider', {
      traceId,
      leadFound: true,
      providerId: verified.payload.providerId,
      jobRequestId: verified.payload.jobRequestId ?? null,
      providerEligibilityCode: eligibility.code,
    })
    return {
      status: 'invalid' as const,
      lead: null,
      payload: verified.payload,
      traceId,
      reason: eligibility.code,
    }
  }

  // Verify providerPhoneHash when the caller supplies the inbound sender phone
  // (WhatsApp path) or when the token itself embeds a hash. This ensures the
  // token cannot be replayed from a different WhatsApp number.
  const expectedHash = verified.payload.providerPhoneHash
  if (expectedHash) {
    const actualHash = hashProviderPhone(lead.provider.phone)
    if (actualHash !== expectedHash) {
      console.warn('[provider-lead-access] token rejected: phone hash mismatch', {
        traceId,
        providerId: verified.payload.providerId,
        leadId: verified.payload.leadId,
        providerPhoneMasked: maskPhone(lead.provider.phone),
      })
      return {
        status: 'invalid' as const,
        lead: null,
        payload: verified.payload,
        traceId,
        reason: 'PROVIDER_PHONE_MISMATCH' as const,
      }
    }
  }

  if (opts?.assertSenderPhone) {
    const senderHash = hashProviderPhone(opts.assertSenderPhone)
    const storedHash = hashProviderPhone(lead.provider.phone)
    if (senderHash !== storedHash) {
      console.warn('[provider-lead-access] token rejected: sender phone does not match provider record', {
        traceId,
        providerId: verified.payload.providerId,
        leadId: verified.payload.leadId,
        senderPhoneMasked: maskPhone(opts.assertSenderPhone),
        providerPhoneMasked: maskPhone(lead.provider.phone),
      })
      return {
        status: 'invalid' as const,
        lead: null,
        payload: verified.payload,
        traceId,
        reason: 'SENDER_PHONE_MISMATCH' as const,
      }
    }
  }

  // If the underlying match was cancelled (job cancelled or reassigned), revoke access.
  if (lead.jobRequest.match?.status === 'CANCELLED') {
    console.warn('[provider-lead-access] token rejected: match cancelled', {
      traceId,
      leadId: lead.id,
      providerId: lead.providerId,
    })
    return {
      status: 'invalid' as const,
      lead: null,
      payload: verified.payload,
      traceId,
      reason: 'MATCH_CANCELLED' as const,
    }
  }

  const acceptedState = lead.status === 'ACCEPTED' || lead.status === 'ACCEPTED_LOCKED'
  const leadUnlock = acceptedState
    ? await db.leadUnlock.findUnique({
        where: { leadId: lead.id },
        select: SAFE_LEAD_UNLOCK_SELECT,
      }).catch((error: unknown) => {
        console.warn('[provider-lead-access] accepted lead unlock lookup failed', {
          traceId,
          leadId: lead.id,
          providerId: lead.providerId,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      })
    : null

  const hasAcceptedUnlock =
    acceptedState &&
    leadUnlock?.providerId === lead.providerId
  const scopedLead = {
    ...lead,
    unlock: hasAcceptedUnlock && leadUnlock
      ? {
          ...leadUnlock,
          creditsCharged: DEFAULT_LEAD_UNLOCK_COST_CREDITS,
        }
      : null,
    jobRequest: {
      ...lead.jobRequest,
      description: hasAcceptedUnlock
        ? lead.jobRequest.description
        : previewNotes(lead.jobRequest.description) ?? '',
      customer: null as { id: string; name: string; phone: string } | null,
      attachments: lead.jobRequest.attachments,
    },
  }

  if (hasAcceptedUnlock) {
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
                region: true,
              },
            },
          },
        },
      },
    })

    if (sensitiveLead) {
      scopedLead.jobRequest.customer = sensitiveLead.jobRequest.customer
      scopedLead.jobRequest.address = sensitiveLead.jobRequest.address
    }
  }

  return { status: 'active' as const, lead: scopedLead, payload: verified.payload, traceId, reason: null }
}

export async function resolveProviderLeadAttachmentScope(token: string) {
  const resolved = await resolveProviderLeadAccessToken(token)
  if (resolved.status !== 'active' || !resolved.lead) {
    return { status: resolved.status, jobRequestId: null, leadId: resolved.payload?.leadId ?? null, traceId: resolved.traceId }
  }

  // Expose whether the provider has an accepted unlock - the attachment proxy
  // uses this to decide whether to enforce safeForPreview on request-level
  // attachments. After acceptance, the provider may view all request attachments.
  const hasAcceptedUnlock =
    (resolved.lead.status === 'ACCEPTED' || resolved.lead.status === 'ACCEPTED_LOCKED') &&
    resolved.lead.unlock?.providerId === resolved.lead.providerId

  return {
    status: 'active' as const,
    jobRequestId: resolved.lead.jobRequestId,
    leadId: resolved.lead.id,
    isAccepted: hasAcceptedUnlock,
    traceId: resolved.traceId,
  }
}
