// ─── Admin: Customers ─────────────────────────────────────────────────────────
// Lists all customers with booking count, last activity, and channel.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { CustomerChannel } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Customers', noIndex: true })

const CHANNEL_OPTIONS = Object.values(CustomerChannel)

interface CustomersPageProps {
  searchParams?: Promise<{
    q?: string
    channel?: string
    blocked?: string
    suspended?: string
    archived?: string
    message?: string
  }>
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const actor = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.customers', { userId: actor.id })
  const filters = (await searchParams) ?? {}
  const q = filters.q?.trim() ?? ''
  const now = new Date()

  const where = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(filters.channel && CHANNEL_OPTIONS.includes(filters.channel as CustomerChannel)
      ? { channel: filters.channel as CustomerChannel }
      : {}),
    ...(filters.blocked === 'true' ? { isBlocked: true } : {}),
    ...(filters.suspended === 'true'
      ? {
          suspendedUntil: {
            gte: now,
          },
        }
      : {}),
    ...(filters.archived === 'true'
      ? {
          archivedAt: {
            not: null,
          },
        }
      : filters.archived === 'false'
        ? {
            archivedAt: null,
          }
        : {}),
  }

  const customers = await db.customer.findMany({
    where,
    include: {
      _count: { select: { jobRequests: true } },
      jobRequests: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const blockedCount = customers.filter((c) => c.isBlocked).length
  const inactiveCount = customers.filter((c) => !c.active).length
  const suspendedCount = customers.filter((c) => c.suspendedUntil && c.suspendedUntil >= now).length

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            {customers.length} matching
            {blockedCount > 0 && <span className="ml-2 text-destructive">· {blockedCount} blocked</span>}
            {suspendedCount > 0 && <span className="ml-2 text-amber-700">· {suspendedCount} suspended</span>}
            {inactiveCount > 0 && <span className="ml-2 text-muted-foreground/70">· {inactiveCount} inactive</span>}
          </p>
        </div>
        {crudEnabled && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/api/admin/customers/export?q=${encodeURIComponent(q)}&channel=${encodeURIComponent(filters.channel ?? '')}&blocked=${encodeURIComponent(filters.blocked ?? '')}&suspended=${encodeURIComponent(filters.suspended ?? '')}&archived=${encodeURIComponent(filters.archived ?? '')}`}
              >
                Export CSV
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/customers/new">Add customer</Link>
            </Button>
          </div>
        )}
      </div>

      {!crudEnabled && (
        <div className="tone-warning mb-4 rounded-lg border px-4 py-2 text-sm">
          Customer mutations are disabled. Enable the <code>admin.crud.customers</code> feature flag to block, deactivate, or add notes.
        </div>
      )}

      {filters.message && (
        <div className="tone-success mb-4 rounded-lg border px-4 py-2 text-sm">
          {filters.message}
        </div>
      )}

      <form className="mb-4 grid gap-3 rounded-xl border p-4 md:grid-cols-5" method="get">
        <input
          type="search"
          name="q"
          placeholder="Search name, phone, email"
          defaultValue={q}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          name="channel"
          defaultValue={filters.channel ?? ''}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All channels</option>
          {CHANNEL_OPTIONS.map((channel) => (
            <option key={channel} value={channel}>
              {channel.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          name="blocked"
          defaultValue={filters.blocked ?? ''}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All block states</option>
          <option value="true">Blocked only</option>
        </select>
        <select
          name="suspended"
          defaultValue={filters.suspended ?? ''}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All suspension states</option>
          <option value="true">Suspended only</option>
        </select>
        <div className="flex gap-2">
          <select
            name="archived"
            defaultValue={filters.archived ?? ''}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All archive states</option>
            <option value="false">Active records only</option>
            <option value="true">Archived only</option>
          </select>
          <Button type="submit" variant="outline" size="sm" className="h-9">
            Filter
          </Button>
        </div>
      </form>

      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Phone</TableHead>
              <TableHead className="hidden md:table-cell">Channel</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="text-right">Bookings</TableHead>
              <TableHead className="text-right hidden lg:table-cell">Last booking</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No customers yet.
                </TableCell>
              </TableRow>
            )}
            {customers.map((c) => {
              const lastJobRequest = c.jobRequests[0]
              const channelLabel = c.channel
                ? c.channel.replace(/_/g, ' ')
                : c.userId
                  ? 'PWA + WhatsApp'
                  : 'WhatsApp'
              const isSuspended = Boolean(c.suspendedUntil && c.suspendedUntil >= now)

              return (
                <TableRow
                  key={c.id}
                  className={`cursor-pointer hover:bg-muted/50 ${!c.active ? 'opacity-50' : ''}`}
                >
                  <TableCell>
                    <Link href={`/admin/customers/${c.id}`} className="block">
                      <p className="font-medium hover:text-primary">{c.name}</p>
                      {c.email && (
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {c.phone}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge
                      variant={c.userId ? 'secondary' : 'outline'}
                      className="rounded-full text-xs"
                    >
                      {channelLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {c.isBlocked ? (
                      <Badge variant="destructive" className="rounded-full text-xs">Blocked</Badge>
                    ) : isSuspended ? (
                      <Badge variant="outline" className="rounded-full border-amber-300 text-xs text-amber-700">Suspended</Badge>
                    ) : !c.active ? (
                      <Badge variant="outline" className="rounded-full text-xs text-muted-foreground">Inactive</Badge>
                    ) : (
                      <Badge variant="default" className="rounded-full text-xs">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {c._count?.jobRequests ?? 0}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground hidden lg:table-cell">
                    {lastJobRequest
                      ? lastJobRequest.createdAt.toLocaleDateString('en-ZA', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
