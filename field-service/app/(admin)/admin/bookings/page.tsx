// ─── Admin: Bookings board ─────────────────────────────────────────────────────
// Table view of all bookings with status filter.
// From here admin can navigate to dispatch to assign a technician.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
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
import { cn } from '@/lib/utils'
import type { BookingStatus } from '@prisma/client'

export const metadata = buildMetadata({ title: 'Bookings', noIndex: true })

const STATUS_OPTIONS: { value: BookingStatus | 'ALL'; label: string }[] = [
  { value: 'ALL',             label: 'All' },
  { value: 'PENDING_PAYMENT', label: 'Pending Payment' },
  { value: 'CONFIRMED',       label: 'Confirmed' },
  { value: 'SCHEDULED',       label: 'Scheduled' },
  { value: 'RESCHEDULED',     label: 'Rescheduled' },
  { value: 'COMPLETED',       label: 'Completed' },
  { value: 'CANCELLED',       label: 'Cancelled' },
]

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireAdmin()
  const { status } = await searchParams

  const statusFilter = (status as BookingStatus) || undefined
  const isValidStatus = STATUS_OPTIONS.some(
    (o) => o.value !== 'ALL' && o.value === statusFilter
  )

  const bookings = await db.booking.findMany({
    where: isValidStatus ? { status: statusFilter } : undefined,
    include: {
      customer: { select: { name: true, phone: true } },
      service:  { select: { name: true, category: true } },
      address:  { select: { suburb: true, city: true } },
      technician: { select: { name: true } },
      job:      { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted-foreground mt-1">{bookings.length} bookings</p>
        </div>
        <Button asChild>
          <Link href="/admin/dispatch">Dispatch →</Link>
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_OPTIONS.map((opt) => {
          const active =
            opt.value === 'ALL'
              ? !statusFilter || !isValidStatus
              : opt.value === statusFilter
          return (
            <Link
              key={opt.value}
              href={opt.value === 'ALL' ? '/admin/bookings' : `/admin/bookings?status=${opt.value}`}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'bg-foreground text-background'
                  : 'border hover:bg-accent text-muted-foreground'
              )}
            >
              {opt.label}
            </Link>
          )
        })}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Booking</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Technician</TableHead>
              <TableHead>Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                  No bookings found
                </TableCell>
              </TableRow>
            )}
            {bookings.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.id.slice(-8).toUpperCase()}</TableCell>
                <TableCell>
                  <p>{b.customer.name}</p>
                  <p className="text-xs text-muted-foreground">{b.customer.phone}</p>
                </TableCell>
                <TableCell>
                  <p>{b.service.name}</p>
                  <p className="text-xs text-muted-foreground">{b.service.category}</p>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {b.address.suburb}, {b.address.city}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {b.scheduledDate
                    ? b.scheduledDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
                    : '—'}
                  {b.scheduledWindow && (
                    <p className="text-xs">{b.scheduledWindow}</p>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={b.status} type="booking" />
                </TableCell>
                <TableCell>
                  {b.job ? (
                    <StatusBadge status={b.job.status} type="job" />
                  ) : (
                    <span className="text-xs text-muted-foreground">No job</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {b.technician?.name ?? '—'}
                </TableCell>
                <TableCell className="font-medium">
                  R {Number(b.totalAmount).toFixed(2)}
                </TableCell>
                <TableCell>
                  {b.status === 'CONFIRMED' && !b.job && (
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/admin/dispatch?bookingId=${b.id}`}>
                        Dispatch
                      </Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
