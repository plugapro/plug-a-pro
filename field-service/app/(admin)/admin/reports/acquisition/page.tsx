// Admin acquisition report — aggregate-only view of paid/organic mix from the
// last 30 days of bookings. No PII exposed; only counts and revenue totals.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  aggregateByCampaign,
  aggregateByChannel,
  aggregateBySource,
  formatChannelLabel,
  type AcquisitionRow,
  type AggregateBucket,
} from '@/lib/admin/acquisition-aggregate'

export const metadata = buildMetadata({ title: 'Acquisition Report', noIndex: true })

export default async function AcquisitionReportPage() {
  await requireAdmin()

  const now = new Date()
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Single query — pull only the columns we aggregate on. Keeps the result set
  // narrow and avoids hydrating customer/provider PII into this report path.
  const bookings = await db.booking.findMany({
    where: {
      createdAt: { gte: since },
      match: { jobRequest: { isTestRequest: false } },
    },
    select: {
      match: {
        select: {
          jobRequest: {
            select: {
              utmSource: true,
              utmMedium: true,
              utmCampaign: true,
            },
          },
        },
      },
      payment: { select: { status: true, amount: true } },
    },
  })

  const rows: AcquisitionRow[] = bookings.map((b) => {
    const jr = b.match?.jobRequest ?? null
    const paid = b.payment?.status === 'PAID'
    return {
      utmSource: jr?.utmSource ?? null,
      utmMedium: jr?.utmMedium ?? null,
      utmCampaign: jr?.utmCampaign ?? null,
      paid,
      amount: paid ? Number(b.payment?.amount ?? 0) : null,
    }
  })

  const byChannel = aggregateByChannel(rows)
  const bySource = aggregateBySource(rows)
  const byCampaign = aggregateByCampaign(rows)

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/reports"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Reports
          </Link>
          <h1 className="mt-2 text-xl font-semibold">Acquisition</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Last 30 days · {bookings.length} bookings
          </p>
        </div>
      </div>

      <ReportTable
        title="By channel"
        keyHeader="Channel"
        rows={byChannel.map((b) => ({ ...b, label: formatChannelLabel(b.key) }))}
      />

      <ReportTable
        title="By source (top 10)"
        keyHeader="Source"
        rows={bySource.map((b) => ({ ...b, label: b.key }))}
      />

      <ReportTable
        title="By campaign (top 10)"
        keyHeader="Campaign"
        rows={byCampaign.map((b) => ({ ...b, label: b.key }))}
      />
    </div>
  )
}

function ReportTable({
  title,
  keyHeader,
  rows,
}: {
  title: string
  keyHeader: string
  rows: Array<AggregateBucket & { label: string }>
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{keyHeader}</TableHead>
              <TableHead className="text-right">Bookings</TableHead>
              <TableHead className="text-right">Paid bookings</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  No data for this period
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{r.bookings}</TableCell>
                <TableCell className="text-right tabular-nums">{r.paidBookings}</TableCell>
                <TableCell className="text-right tabular-nums">
                  R {r.revenue.toLocaleString('en-ZA', { minimumFractionDigits: 0 })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
