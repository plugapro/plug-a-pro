// ─── Admin: Technicians ────────────────────────────────────────────────────────
// Lists all technicians with active job count and status.

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

export const metadata = buildMetadata({ title: 'Technicians', noIndex: true })

export default async function TechniciansPage() {
  const user = await requireAdmin()
  let businessId = user.businessId
  if (!businessId) {
    const { resolveBusinessId } = await import('@/lib/auth')
    businessId = await resolveBusinessId()
  }

  const technicians = await db.technician.findMany({
    where: { businessId },
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
        <h1 className="text-2xl font-bold">Technicians</h1>
        <p className="text-sm text-muted-foreground">{technicians.length} registered</p>
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
            {technicians.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No technicians yet. Approve applications to add technicians.
                </TableCell>
              </TableRow>
            )}
            {technicians.map((tech) => {
              const isActive  = tech.jobs.length > 0
              const activeJob = tech.jobs[0]

              return (
                <TableRow key={tech.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/admin/technicians/${tech.id}`} className="block">
                      <p className="font-medium hover:text-primary">{tech.name}</p>
                      {tech.email && (
                        <p className="text-xs text-muted-foreground">{tech.email}</p>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {tech.phone}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {tech.skills.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {tech.skills.slice(0, 3).map((skill) => (
                          <Badge key={skill} variant="secondary" className="rounded-full text-xs">
                            {skill}
                          </Badge>
                        ))}
                        {tech.skills.length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{tech.skills.length - 3}
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
                    {tech._count.jobs}
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
