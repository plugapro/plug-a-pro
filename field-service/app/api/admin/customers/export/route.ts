import { CustomerChannel } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { toCsv } from '@/lib/csv'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const actor = await requireAdmin()
  const enabled = await isEnabled('admin.crud.customers', actor.id)
  if (!enabled) {
    return new Response('Feature flag disabled', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  const channel = searchParams.get('channel')
  const blocked = searchParams.get('blocked')
  const suspended = searchParams.get('suspended')
  const archived = searchParams.get('archived')
  const now = new Date()

  const rows = await db.customer.findMany({
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
      ...(channel && Object.values(CustomerChannel).includes(channel as CustomerChannel)
        ? { channel: channel as CustomerChannel }
        : {}),
      ...(blocked === 'true' ? { isBlocked: true } : {}),
      ...(suspended === 'true'
        ? {
            suspendedUntil: {
              gte: now,
            },
          }
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
      channel: true,
      active: true,
      isBlocked: true,
      suspendedUntil: true,
      archivedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const csv = toCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'channel', label: 'Channel' },
    { key: 'active', label: 'Active' },
    { key: 'isBlocked', label: 'Blocked' },
    { key: 'suspendedUntil', label: 'Suspended Until' },
    { key: 'archivedAt', label: 'Archived At' },
    { key: 'createdAt', label: 'Created At' },
  ])

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
