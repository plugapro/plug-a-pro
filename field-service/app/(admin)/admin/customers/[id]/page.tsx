// ─── Admin: Customer detail ───────────────────────────────────────────────────
// Contact info + full booking history for a single customer.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
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
  await requireAdmin()

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      jobRequests: {
        orderBy: { createdAt: 'desc' },
        include: {
          match: {
            include: {
              booking: {
                include: {
                  payment: { select: { status: true, amount: true } },
                },
              },
            },
          },
        },
      },
      _count: { select: { jobRequests: true } },
    },
  })

  if (!customer) notFound()

  // Flatten to a list of bookings with enough context to render the table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookings = customer.jobRequests.flatMap((jr: any) =>
    jr.match?.booking
      ? [{
          id:          jr.match.booking.id,
          createdAt:   jr.match.booking.createdAt,
          status:      jr.match.booking.status,
          payment:     jr.match.booking.payment,
          jobTitle:    jr.title,
        }]
      : []
  )

  const lastBooking = bookings[0]
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
          Booking history ({customer._count?.jobRequests ?? 0})
        </h2>
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Job Request</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No bookings yet.
                  </TableCell>
                </TableRow>
              )}
              {bookings.map((b: {
                id: string
                createdAt: Date
                status: string
                payment: { status: string; amount: number | null } | null
                jobTitle: string
              }) => (
                <TableRow key={b.id} className="hover:bg-muted/30">
                  <TableCell>
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="font-mono text-xs hover:text-primary"
                    >
                      {b.id.slice(-8).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.jobTitle ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.createdAt.toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={b.status as import('@prisma/client').BookingStatus} type="booking" />
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
