// ─── Admin: Customers ─────────────────────────────────────────────────────────
// Lists all customers with booking count, last activity, and channel.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Customers', noIndex: true })

export default async function CustomersPage() {
  const user = await requireAdmin()
  let businessId = user.businessId
  if (!businessId) {
    const { resolveBusinessId } = await import('@/lib/auth')
    businessId = await resolveBusinessId()
  }

  const customers = await db.customer.findMany({
    where: { businessId },
    include: {
      _count: { select: { bookings: true } },
      bookings: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, status: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-sm text-muted-foreground">{customers.length} total</p>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Phone</TableHead>
              <TableHead className="hidden md:table-cell">Channel</TableHead>
              <TableHead className="text-right">Bookings</TableHead>
              <TableHead className="text-right hidden lg:table-cell">Last booking</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No customers yet.
                </TableCell>
              </TableRow>
            )}
            {customers.map((c) => {
              const lastBooking = c.bookings[0]
              // If userId is set, they've authenticated via PWA; otherwise WhatsApp-only
              const channel = c.userId ? 'PWA + WhatsApp' : 'WhatsApp'

              return (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50">
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
                      {channel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {c._count.bookings}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground hidden lg:table-cell">
                    {lastBooking
                      ? lastBooking.createdAt.toLocaleDateString('en-ZA', {
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
