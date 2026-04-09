import type { Prisma } from '@prisma/client'
import { db } from './db'

type AuditClient = Pick<typeof db, 'auditLog'>

export async function recordAuditLog(
  params: {
    actorId: string
    actorRole: string
    action: string
    entityType: string
    entityId: string
    before?: Prisma.InputJsonValue | null
    after?: Prisma.InputJsonValue | null
    ipAddress?: string | null
    userAgent?: string | null
  },
  client: AuditClient = db
) {
  await client.auditLog.create({
    data: {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before ?? undefined,
      after: params.after ?? undefined,
      ipAddress: params.ipAddress ?? undefined,
      userAgent: params.userAgent ?? undefined,
    },
  })
}
