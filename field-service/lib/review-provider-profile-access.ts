import { createHmac, timingSafeEqual } from 'crypto'
import { db } from './db'
import { getPublicAppUrl } from './provider-credit-copy'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

type ReviewProviderProfileTokenPayload = {
  v: 1
  requestId: string
  providerId: string
  exp: number
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url')
}

function getSigningSecret() {
  const secret =
    process.env.REVIEW_PROVIDER_PROFILE_ACCESS_SECRET ||
    process.env.PROVIDER_LEAD_ACCESS_SECRET ||
    process.env.NEXTAUTH_SECRET

  if (!secret) {
    throw new Error('Missing review provider profile signing secret. Set REVIEW_PROVIDER_PROFILE_ACCESS_SECRET.')
  }

  return secret
}

function signPayload(encodedPayload: string) {
  return createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url')
}

function parsePayload(encodedPayload: string): ReviewProviderProfileTokenPayload | null {
  try {
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as Partial<ReviewProviderProfileTokenPayload>
    if (
      parsed.v !== 1 ||
      typeof parsed.requestId !== 'string' ||
      typeof parsed.providerId !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    return parsed as ReviewProviderProfileTokenPayload
  } catch {
    return null
  }
}

export function createReviewProviderProfileToken(params: {
  requestId: string
  providerId: string
  expiresAt?: Date
}) {
  const exp = Math.floor((params.expiresAt?.getTime() ?? Date.now() + TOKEN_TTL_MS) / 1000)
  const payload: ReviewProviderProfileTokenPayload = {
    v: 1,
    requestId: params.requestId,
    providerId: params.providerId,
    exp,
  }
  const encodedPayload = base64url(JSON.stringify(payload))
  const signature = signPayload(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function verifyReviewProviderProfileToken(token: string) {
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

export function getReviewProviderProfileUrl(params: {
  requestId: string
  providerId: string
  expiresAt?: Date
}) {
  const appUrl = getPublicAppUrl()
  if (!appUrl) return null
  const token = createReviewProviderProfileToken(params)
  return `${appUrl}/provider-public-profile/${encodeURIComponent(token)}`
}

export async function resolveReviewProviderProfileToken(token: string) {
  const verified = verifyReviewProviderProfileToken(token)
  if (verified.status !== 'active') {
    return { status: verified.status, request: null, provider: null, matchReason: null, tokenPayload: verified.payload }
  }

  const request = await db.jobRequest.findUnique({
    where: { id: verified.payload.requestId },
    select: {
      id: true,
      customerId: true,
      status: true,
      assignmentMode: true,
      latestDispatchDecisionId: true,
      category: true,
      address: { select: { suburb: true, city: true, province: true } },
      leads: {
        where: { providerId: verified.payload.providerId },
        select: { id: true, status: true },
      },
    },
  })
  if (!request) {
    return { status: 'invalid' as const, request: null, provider: null, matchReason: null, tokenPayload: verified.payload }
  }

  const provider = await db.provider.findUnique({
    where: { id: verified.payload.providerId },
    select: {
      id: true,
      active: true,
      name: true,
      bio: true,
      avatarUrl: true,
      experience: true,
      serviceAreas: true,
      skills: true,
      verified: true,
      averageRating: true,
      completedJobsCount: true,
      portfolioUrls: true,
      providerCategories: {
        select: {
          categorySlug: true,
          approvalStatus: true,
        },
      },
      providerRates: {
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          categorySlug: true,
          callOutFee: true,
          hourlyRate: true,
          rateNegotiable: true,
        },
      },
    },
  })
  if (!provider || !provider.active) {
    return { status: 'invalid' as const, request: null, provider: null, matchReason: null, tokenPayload: verified.payload }
  }

  const attempt = request.latestDispatchDecisionId
    ? await db.matchAttempt.findFirst({
        where: {
          dispatchDecisionId: request.latestDispatchDecisionId,
          providerId: provider.id,
        },
        select: { score: true, reasonCode: true, feasibilityNotes: true },
      })
    : null

  const lead = request.leads[0] ?? null

  return {
    status: 'active' as const,
    request,
    provider: {
      id: provider.id,
      name: provider.name,
      bio: provider.bio,
      avatarUrl: provider.avatarUrl,
      experience: provider.experience,
      serviceAreas: provider.serviceAreas,
      skills: provider.skills,
      verified: provider.verified,
      averageRating: provider.averageRating,
      completedJobsCount: provider.completedJobsCount,
      portfolioUrls: provider.portfolioUrls,
      rates: provider.providerRates,
      categories: provider.providerCategories,
      leadStatus: lead?.status ?? null,
    },
    matchReason: attempt?.feasibilityNotes?.[0] ?? 'Matched for service and area fit.',
    tokenPayload: verified.payload,
  }
}
