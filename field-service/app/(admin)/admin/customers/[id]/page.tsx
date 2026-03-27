// ─── Admin: Customer detail ───────────────────────────────────────────────────
// Contact info + full booking history for a single customer.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin, resolveBusinessId } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { formatCurrency } from '@/lib/payments'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ArrowLeft } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Customer', noIndex: true })

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireAdmin()
  let businessId = user.businessId
  if (!businessId) {
    businessId = await resolveBusinessId()
  }

  const customer = await db.customer.findFirst({
    where: { id, businessId },
    include: {
      bookings: {
        orderBy: { createdAt: 'desc' },
        include: {
          service: { select: { name: true } },
          payment: { select: { status: true, amount: true } },
        },
      },
      _count: { select: { bookings: true } },
    },
  })

  if (!customer) notFound()

  const lastBooking = customer.bookings[0]
  const channel = customer.userId ? 'PWA + WhatsApp' : 'WhatsApp only'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Customers
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{customer.phone}</p>
        </div>
        <Badge variant={customer.userId ? 'secondary' : 'outline'} className="rounded-full">
          {channel}
        </Badge>
      </div>

      {/* Contact info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Contact
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Phone">{customer.phone}</Row>
          {customer.email && <Row label="Email">{customer.email}</Row>}
          <Row label="Channel">{channel}</Row>
          <Row label="Customer since">
            {customer.createdAt.toLocaleDateString('en-ZA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Row>
          {lastBooking && (
            <Row label="Last booking">
              {lastBooking.createdAt.toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Row>
          )}
        </CardContent>
      </Card>

      {/* Booking history */}
      <div>
        <h2 className="text-sm font-semibold mb-3">
          Booking history ({customer._count.bookings})
        </h2>
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customer.bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No bookings yet.
                  </TableCell>
                </TableRow>
              )}
              {customer.bookings.map((b) => (
                <TableRow key={b.id} className="hover:bg-muted/30">
                  <TableCell>
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="font-mono text-xs hover:text-primary"
                    >
                      {b.id.slice(-8).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{b.service.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.createdAt.toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} type="booking" />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {b.payment?.amount != null
                      ? formatCurrency(Number(b.payment.amount))
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-32 flex-shrink-0">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  )
}
