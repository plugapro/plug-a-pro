import { randomBytes, createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { db } from './db'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

type Tx = Prisma.TransactionClient | typeof db

export function generateRawToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashProviderResumeToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export interface IssueArgs {
  conversationId: string
  phone: string
  issuedByAdminUserId: string
  source: 'recovery_nudge'
}

export async function issueProviderResumeToken(
  client: Tx,
  args: IssueArgs,
): Promise<{ rawToken: string; tokenId: string; expiresAt: Date }> {
  const rawToken = generateRawToken()
  const tokenHash = hashProviderResumeToken(rawToken)
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS)

  const tokenId = await (client as typeof db).$transaction(async (tx) => {
    await tx.providerResumeToken.updateMany({
      where: { conversationId: args.conversationId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'superseded' },
    })
    const row = await tx.providerResumeToken.create({
      data: {
        tokenHash,
        conversationId: args.conversationId,
        phone: args.phone,
        issuedByAdminUserId: args.issuedByAdminUserId,
        expiresAt,
        source: args.source,
      },
      select: { id: true },
    })
    return row.id
  })

  return { rawToken, tokenId, expiresAt }
}

export type ValidateResult =
  | { ok: true; tokenId: string; conversationId: string; phone: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' | 'revoked' }

export async function validateProviderResumeToken(client: Tx, rawToken: string): Promise<ValidateResult> {
  if (!rawToken || rawToken.length < 32) return { ok: false, reason: 'not_found' }
  const tokenHash = hashProviderResumeToken(rawToken)
  const row = await client.providerResumeToken.findUnique({ where: { tokenHash } })
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.usedAt) return { ok: false, reason: 'used' }
  if (row.revokedAt) return { ok: false, reason: 'revoked' }
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, tokenId: row.id, conversationId: row.conversationId, phone: row.phone }
}

export async function consumeProviderResumeToken(client: Tx, tokenId: string): Promise<boolean> {
  const result = await client.providerResumeToken.updateMany({
    where: { id: tokenId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  return result.count === 1
}

export async function revokeProviderResumeTokensForConversation(
  client: Tx,
  conversationId: string,
  reason: 'admin_revoked' | 'superseded' = 'admin_revoked',
): Promise<number> {
  const result = await client.providerResumeToken.updateMany({
    where: { conversationId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
  return result.count
}
