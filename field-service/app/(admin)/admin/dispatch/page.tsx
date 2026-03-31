// ─── Admin: Matches ────────────────────────────────────────────────────────────
// Lists Match records with status, job request info, and provider info.

export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Matches', noIndex: true })

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MatchesPage() {
  await requireAdmin()

  const matches = await db.match.findMany({
    include: {
      jobRequest: {
        select: {
          id: true,
          title: true,
          category: true,
          status: true,
          customer: { select: { name: true, phone: true } },
        },
      },
      provider: {
        select: {
          id: true,
          name: true,
          phone: true,
          skills: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Matches</h1>
        <p className="text-sm text-muted-foreground mt-1">{matches.length} matches</p>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Job Request</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Match Status</TableHead>
              <TableHead>Job Request Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No matches yet.
                </TableCell>
              </TableRow>
            )}
            {matches.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.id.slice(-8).toUpperCase()}</TableCell>
                <TableCell>
                  <p className="font-medium">{m.jobRequest.title}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {m.jobRequest.id.slice(-8).toUpperCase()}
                  </p>
                </TableCell>
                <TableCell>
                  <p>{m.jobRequest.customer.name}</p>
                  <p className="text-xs text-muted-foreground">{m.jobRequest.customer.phone}</p>
                </TableCell>
                <TableCell>
                  <p>{m.provider.name}</p>
                  <p className="text-xs text-muted-foreground">{m.provider.phone}</p>
                </TableCell>
                <TableCell className="text-muted-foreground">{m.jobRequest.category}</TableCell>
                <TableCell>
                  <StatusBadge status={m.status} type="match" />
                </TableCell>
                <TableCell>
                  <StatusBadge status={m.jobRequest.status} type="jobRequest" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
