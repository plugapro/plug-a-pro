import { randomBytes } from 'crypto'
import { db } from './db'
import { getPublicAppUrl } from './provider-credit-copy'

const ACCESS_TOKEN_TTL_DAYS = 90

function buildExpiryDate() {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + ACCESS_TOKEN_TTL_DAYS)
  return expiresAt
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

  return { token, expiresAt }
}

export async function getJobRequestAccessUrl(jobRequestId: string, intent?: string) {
  const appUrl = getPublicAppUrl()
  if (!appUrl) return null
  const { token } = await ensureJobRequestAccessToken(jobRequestId)
  const query = intent ? `?intent=${encodeURIComponent(intent)}` : ''
  return `${appUrl}/requests/access/${token}${query}`
}

export async function resolveJobRequestAccessScope(token: string) {
  const jobRequest = await db.jobRequest.findUnique({
    where: { customerAccessToken: token },
    select: {
      id: true,
      customerAccessTokenExpiresAt: true,
      customerAccessTokenRevokedAt: true,
    },
  })

  if (!jobRequest) {
    return { status: 'invalid' as const, jobRequestId: null }
  }

  const now = new Date()
  if (
    jobRequest.customerAccessTokenRevokedAt ||
    !jobRequest.customerAccessTokenExpiresAt ||
    jobRequest.customerAccessTokenExpiresAt <= now
  ) {
    return { status: 'expired' as const, jobRequestId: jobRequest.id }
  }

  return { status: 'active' as const, jobRequestId: jobRequest.id }
}

export async function resolveJobRequestAccessToken(token: string) {
  const jobRequest = await db.jobRequest.findUnique({
    where: { customerAccessToken: token },
    include: {
      customer: { select: { id: true, userId: true, name: true, phone: true } },
      address: true,
      attachments: {
        where: { label: 'customer_photo' },
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

  if (!jobRequest) return { status: 'invalid' as const, jobRequest: null }

  const now = new Date()
  if (
    jobRequest.customerAccessTokenRevokedAt ||
    !jobRequest.customerAccessTokenExpiresAt ||
    jobRequest.customerAccessTokenExpiresAt <= now
  ) {
    return { status: 'expired' as const, jobRequest }
  }

  return { status: 'active' as const, jobRequest }
}
