import { KycStatus, ProviderStatus } from '@prisma/client'
import { requireRoleApi } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { toCsv } from '@/lib/csv'
import { AUDIT_ENTITY } from '@/lib/audit-entities'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const actorOrError = await requireRoleApi(['ADMIN', 'OWNER'])
  if (actorOrError instanceof Response) return actorOrError
  const actor = actorOrError
  const enabled = await isEnabled('admin.crud.providers', { userId: actor.id })
  if (!enabled) {
    return new Response('Feature flag disabled', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  const status = searchParams.get('status')
  const kyc = searchParams.get('kyc')
  const archived = searchParams.get('archived')

  const rows = await db.provider.findMany({
    where: {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(status && Object.values(ProviderStatus).includes(status as ProviderStatus)
        ? { status: status as ProviderStatus }
        : {}),
      ...(kyc && Object.values(KycStatus).includes(kyc as KycStatus)
        ? { kycStatus: kyc as KycStatus }
        : {}),
      ...(archived === 'true'
        ? { archivedAt: { not: null } }
        : archived === 'false'
          ? { archivedAt: null }
          : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      status: true,
      kycStatus: true,
      verified: true,
      active: true,
      skills: true,
      serviceAreas: true,
      archivedAt: true,
      createdAt: true,
    },
    orderBy: { name: 'asc' },
  })

  const csv = toCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status' },
    { key: 'kycStatus', label: 'KYC Status' },
    { key: 'verified', label: 'Verified' },
    { key: 'active', label: 'Active' },
    { key: 'skills', label: 'Skills' },
    { key: 'serviceAreas', label: 'Service Areas' },
    { key: 'archivedAt', label: 'Archived At' },
    { key: 'createdAt', label: 'Created At' },
  ])

  await db.adminAuditEvent.create({
    data: {
      adminId: actor.adminUserId ?? actor.id,
      action: 'provider.export',
      entityType: AUDIT_ENTITY.PROVIDER,
      entityId: 'bulk',
      metadata: { rowCount: rows.length, filters: { q, status, kyc, archived } },
      ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    },
  }).catch((err) => console.error('[providers/export] audit write failed', err))

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="providers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
