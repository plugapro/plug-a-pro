import { createHmac, timingSafeEqual } from 'crypto'
import { db } from './db'
import { getPublicAppUrl } from './provider-credit-copy'

const REVIEW_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000
export type ReviewerType = 'CUSTOMER' | 'PROVIDER'
type ReviewAccessPayload = { v: 1; matchId: string; reviewerType: ReviewerType; exp: number }

function base64url(input: Buffer | string) { return Buffer.from(input).toString('base64url') }
function getSigningSecret() {
  const s = process.env.REVIEW_ACCESS_SECRET || process.env.CUSTOMER_HANDOVER_ACCESS_SECRET || process.env.PROVIDER_LEAD_ACCESS_SECRET || process.env.NEXTAUTH_SECRET || process.env.WHATSAPP_APP_SECRET || process.env.CRON_SECRET
  if (!s) throw new Error('Missing REVIEW_ACCESS_SECRET or fallback')
  return s
}
function signPayload(e: string) { return createHmac('sha256', getSigningSecret()).update(e).digest('base64url') }
function parsePayload(e: string): ReviewAccessPayload | null {
  try {
    const p = JSON.parse(Buffer.from(e, 'base64url').toString('utf8')) as Partial<ReviewAccessPayload>
    if (p.v !== 1 || typeof p.matchId !== 'string' || (p.reviewerType !== 'CUSTOMER' && p.reviewerType !== 'PROVIDER') || typeof p.exp !== 'number') return null
    return p as ReviewAccessPayload
  } catch { return null }
}

export function createReviewAccessToken(params: { matchId: string; reviewerType: ReviewerType; expiresAt?: Date }) {
  const exp = Math.floor((params.expiresAt?.getTime() ?? Date.now() + REVIEW_ACCESS_TTL_MS) / 1000)
  const payload: ReviewAccessPayload = { v: 1, matchId: params.matchId, reviewerType: params.reviewerType, exp }
  const e = base64url(JSON.stringify(payload))
  return `${e}.${signPayload(e)}`
}

export function verifyReviewAccessToken(token: string) {
  const [e, sig] = token.split('.')
  if (!e || !sig) return { status: 'invalid' as const, payload: null }
  const exp = signPayload(e)
  if (Buffer.from(sig).length !== Buffer.from(exp).length || !timingSafeEqual(Buffer.from(sig), Buffer.from(exp)))
    return { status: 'invalid' as const, payload: null }
  const p = parsePayload(e)
  if (!p) return { status: 'invalid' as const, payload: null }
  if (p.exp <= Math.floor(Date.now() / 1000)) return { status: 'expired' as const, payload: p }
  return { status: 'active' as const, payload: p }
}

export function createReviewUrl(params: { matchId: string; reviewerType: ReviewerType; expiresAt?: Date }): string | null {
  const appUrl = getPublicAppUrl()
  if (!appUrl) return null
  return `${appUrl}/review/${encodeURIComponent(createReviewAccessToken(params))}`
}

export async function resolveReviewAccessToken(token: string) {
  const v = verifyReviewAccessToken(token)
  if (v.status !== 'active') return { status: v.status, payload: v.payload, context: null }
  const { matchId, reviewerType } = v.payload
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true, status: true, completionCheckStatus: true,
      jobRequest: { select: { id: true, category: true, title: true, customer: { select: { id: true, name: true, phone: true } } } },
      provider: { select: { id: true, name: true, phone: true, avatarUrl: true } },
      reviews: { where: { reviewerType }, select: { id: true, score: true, comment: true, createdAt: true }, take: 1 },
    },
  })
  if (!match || match.status === 'CANCELLED') return { status: 'invalid' as const, payload: v.payload, context: null }
  return {
    status: 'active' as const, payload: v.payload,
    context: { matchId: match.id, reviewerType, jobCategory: match.jobRequest.category, jobTitle: match.jobRequest.title, jobRequestId: match.jobRequest.id, customer: match.jobRequest.customer, provider: match.provider, existingReview: match.reviews[0] ?? null },
  }
}
