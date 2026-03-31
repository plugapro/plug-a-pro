// ─── Admin: Providers ──────────────────────────────────────────────────────────
// Lists all providers with active job count and status.

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

export const metadata = buildMetadata({ title: 'Providers', noIndex: true })

export default async function ProvidersPage() {
  await requireAdmin()

  const providers = await db.provider.findMany({
    include: {
      _count: {
        select: {
          jobs: { where: { status: { notIn: ['COMPLETED', 'FAILED'] } } },
        },
      },
      jobs: {
        where: { status: { in: ['EN_ROUTE', 'ARRIVED', 'STARTED', 'AWAITING_APPROVAL'] } },
        take: 1,
        select: { status: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Providers</h1>
        <p className="text-sm text-muted-foreground">{providers.length} registered</p>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Phone</TableHead>
              <TableHead className="hidden md:table-cell">Skills</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Active Jobs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No providers yet. Approve applications to add providers.
                </TableCell>
              </TableRow>
            )}
            {providers.map((provider) => {
              const isActive  = provider.jobs.length > 0
              const activeJob = provider.jobs[0]

              return (
                <TableRow key={provider.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/admin/providers/${provider.id}`} className="block">
                      <p className="font-medium hover:text-primary">{provider.name}</p>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {provider.phone}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {provider.skills.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {provider.skills.slice(0, 3).map((skill) => (
                          <Badge key={skill} variant="secondary" className="rounded-full text-xs">
                            {skill}
                          </Badge>
                        ))}
                        {provider.skills.length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{provider.skills.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isActive ? (
                      <Badge variant="default" className="rounded-full capitalize">
                        {activeJob?.status.replace(/_/g, ' ').toLowerCase() ?? 'active'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="rounded-full">
                        available
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {provider._count.jobs}
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
