import { randomBytes } from 'crypto'
import { db } from './db'
import { getPublicAppUrl } from './provider-credit-copy'
import { createTraceId } from './support-diagnostics'

// Client request access tokens should align with the blueprint hardening window.
// Existing issued tokens keep their persisted expiry; this value affects only
// newly issued or refreshed tokens.
const ACCESS_TOKEN_TTL_HOURS = 72

function buildExpiryDate() {
  return new Date(Date.now() + ACCESS_TOKEN_TTL_HOURS * 60 * 60 * 1000)
}

function generateAccessToken() {
  return randomBytes(24).toString('hex')
}

export async function ensureJobRequestAccessToken(jobRequestId: string) {
  const existing = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      customerAccessToken: true,
      customerAccessTokenExpiresAt: true,
      customerAccessTokenRevokedAt: true,
    },
  })

  if (!existing) {
    throw new Error(`Job request not found: ${jobRequestId}`)
  }

  const now = new Date()
  const isUsable =
    existing.customerAccessToken &&
    existing.customerAccessTokenRevokedAt == null &&
    existing.customerAccessTokenExpiresAt != null &&
    existing.customerAccessTokenExpiresAt > now

  if (isUsable) {
    console.info('[job-request-access] existing ticket token reused', {
      jobRequestId,
      expiresAt: existing.customerAccessTokenExpiresAt,
    })
    return {
      token: existing.customerAccessToken!,
      expiresAt: existing.customerAccessTokenExpiresAt!,
    }
  }

  const token = generateAccessToken()
  const expiresAt = buildExpiryDate()

  await db.jobRequest.update({
    where: { id: jobRequestId },
    data: {
      customerAccessToken: token,
      customerAccessTokenExpiresAt: expiresAt,
      customerAccessTokenRevokedAt: null,
    },
  })

  console.info('[job-request-access] ticket token generated', {
    jobRequestId,
    expiresAt,
  })

  return { token, expiresAt }
}

export async function getJobRequestAccessUrl(jobRequestId: string, view?: string) {
  const appUrl = getPublicAppUrl()
  if (!appUrl) return null
  const { token } = await ensureJobRequestAccessToken(jobRequestId)
  const query = view ? `?view=${encodeURIComponent(view)}` : ''
  console.info('[job-request-access] ticket url generated', {
    jobRequestId,
    view: view ?? null,
  })
  return `${appUrl}/requests/access/${token}${query}`
}

export async function resolveJobRequestAccessScope(token: string) {
  const traceId = createTraceId('jra')
  const jobRequest = await db.jobRequest.findUnique({
    where: { customerAccessToken: token },
    select: {
      id: true,
      customerAccessTokenExpiresAt: true,
      customerAccessTokenRevokedAt: true,
    },
  })

  if (!jobRequest) {
    console.warn(`[job-request-access:${traceId}] token invalid: no matching record`)
    return { status: 'invalid' as const, jobRequestId: null, traceId }
  }

  const now = new Date()
  if (
    jobRequest.customerAccessTokenRevokedAt ||
    !jobRequest.customerAccessTokenExpiresAt ||
    jobRequest.customerAccessTokenExpiresAt <= now
  ) {
    console.warn(`[job-request-access:${traceId}] token expired or revoked: jobRequest=${jobRequest.id}`)
    return { status: 'expired' as const, jobRequestId: jobRequest.id, traceId }
  }

  return { status: 'active' as const, jobRequestId: jobRequest.id, traceId }
}

export async function resolveJobRequestAccessToken(token: string) {
  const traceId = createTraceId('jrt')
  const jobRequest = await db.jobRequest.findUnique({
    where: { customerAccessToken: token },
    select: {
      id: true,
      customerId: true,
      category: true,
      title: true,
      description: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      selectedLeadInviteId: true,
      customerAccessTokenExpiresAt: true,
      customerAccessTokenRevokedAt: true,
      customer: { select: { id: true, userId: true, name: true, phone: true } },
      address: true,
      attachments: {
        where: { label: { in: ['customer_photo', 'evidence'] }, safeForPreview: true },
        orderBy: { createdAt: 'asc' },
      },
      leads: {
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              skills: true,
            },
          },
        },
        orderBy: { sentAt: 'desc' },
      },
      match: {
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              bio: true,
              experience: true,
              skills: true,
              serviceAreas: true,
              evidenceNote: true,
              portfolioUrls: true,
              verified: true,
            },
          },
          quotes: {
            orderBy: { createdAt: 'desc' },
          },
          booking: {
            include: {
              quote: true,
              payment: true,
              job: {
                include: {
                  photos: {
                    orderBy: { createdAt: 'asc' },
                  },
                  extras: {
                    orderBy: { createdAt: 'desc' },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!jobRequest) {
    console.warn(`[job-request-access:${traceId}] token invalid: no matching record`)
    return { status: 'invalid' as const, jobRequest: null, traceId }
  }

  const now = new Date()
  if (
    jobRequest.customerAccessTokenRevokedAt ||
    !jobRequest.customerAccessTokenExpiresAt ||
    jobRequest.customerAccessTokenExpiresAt <= now
  ) {
    console.warn(`[job-request-access:${traceId}] token expired or revoked: jobRequest=${jobRequest.id}`)
    // Strip all token columns before returning — callers must not re-expose them.
    // customerAccessToken is not in the select above, but we strip it defensively
    // in case the shape is widened or the mock includes it.
    const {
      customerAccessToken: _tok,
      customerAccessTokenExpiresAt: _exp,
      customerAccessTokenRevokedAt: _rev,
      ...safeJobRequest
    } = jobRequest as typeof jobRequest & { customerAccessToken?: unknown }
    return { status: 'expired' as const, jobRequest: safeJobRequest, traceId }
  }

  // Strip token columns from the returned shape so callers never re-expose the secret
  const {
    customerAccessToken: _tok,
    customerAccessTokenExpiresAt: _exp,
    customerAccessTokenRevokedAt: _rev,
    ...safeJobRequest
  } = jobRequest as typeof jobRequest & { customerAccessToken?: unknown }
  return { status: 'active' as const, jobRequest: safeJobRequest, traceId }
}
