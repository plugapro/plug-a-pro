// ─── Admin: Customers ─────────────────────────────────────────────────────────
// Lists all customers with booking count, last activity, and channel.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
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
  const actor = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.customers', actor.id)

  const customers = await db.customer.findMany({
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-sm text-muted-foreground">
          {customers.length} total
          {blockedCount > 0 && <span className="ml-2 text-destructive">· {blockedCount} blocked</span>}
          {inactiveCount > 0 && <span className="ml-2 text-muted-foreground/70">· {inactiveCount} inactive</span>}
        </p>
      </div>

      {!crudEnabled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Customer mutations are disabled. Enable the <code>admin.crud.customers</code> feature flag to block, deactivate, or add notes.
        </div>
      )}

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
              const channel = c.userId ? 'PWA + WhatsApp' : 'WhatsApp'

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
                      {channel}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {c.isBlocked ? (
                      <Badge variant="destructive" className="rounded-full text-xs">Blocked</Badge>
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
