// ─── Admin: Technician Profile ────────────────────────────────────────────────
// Full profile view for a single technician: stats, recent jobs, toggle active.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowLeft } from 'lucide-react'
import { format } from 'date-fns'

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata = buildMetadata({ title: 'Technician Profile', noIndex: true })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jobStatusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'COMPLETED':
      return 'default'
    case 'FAILED':
    case 'CALLBACK_REQUIRED':
      return 'destructive'
    case 'ASSIGNED':
      return 'outline'
    default:
      return 'secondary'
  }
}

function formatJobStatus(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

// ─── Server action ────────────────────────────────────────────────────────────

async function toggleActive(technicianId: string, currentActive: boolean) {
  'use server'
  await db.technician.update({
    where: { id: technicianId },
    data: { active: !currentActive },
  })
  redirect(`/admin/technicians/${technicianId}`)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string }>
}

export default async function TechnicianProfilePage({ params }: Props) {
  const { id } = await params

  const user = await requireAdmin()
  let businessId = user.businessId
  if (!businessId) {
    const { resolveBusinessId } = await import('@/lib/auth')
    businessId = await resolveBusinessId()
  }

  const technician = await db.technician.findFirst({
    where: { id, businessId },
    include: {
      jobs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          booking: {
            include: {
              service: { select: { name: true } },
            },
          },
        },
      },
      availability: {
        orderBy: { dayOfWeek: 'asc' },
      },
      _count: {
        select: {
          jobs: true,
        },
      },
    },
  })

  if (!technician) notFound()

  // Stats
  const totalJobs = technician._count.jobs
  const completedJobs = technician.jobs.filter((j) => j.status === 'COMPLETED').length
  // Completion rate is based on the full set — fetch completed count separately
  const completedTotal = await db.job.count({
    where: { technicianId: id, status: 'COMPLETED' },
  })
  const completionRate =
    totalJobs > 0 ? Math.round((completedTotal / totalJobs) * 100) : 0

  // Current activity: any non-terminal active job
  const activeJob = technician.jobs.find((j) =>
    ['EN_ROUTE', 'ARRIVED', 'STARTED', 'AWAITING_APPROVAL'].includes(j.status)
  )

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Bind the server action for this specific technician
  const toggleActiveForTech = toggleActive.bind(null, technician.id, technician.active)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/technicians">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{technician.name}</h1>
            {activeJob ? (
              <Badge variant="default" className="rounded-full capitalize shrink-0">
                {formatJobStatus(activeJob.status)}
              </Badge>
            ) : technician.active ? (
              <Badge variant="outline" className="rounded-full shrink-0">
                available
              </Badge>
            ) : (
              <Badge variant="secondary" className="rounded-full shrink-0">
                inactive
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">Technician profile</p>
        </div>
        <form action={toggleActiveForTech}>
          <Button
            type="submit"
            variant={technician.active ? 'destructive' : 'default'}
            size="sm"
          >
            {technician.active ? 'Deactivate' : 'Activate'}
          </Button>
        </form>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Profile card */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Name</p>
                <p className="font-medium">{technician.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="font-medium">{technician.phone}</p>
              </div>
              {technician.email && (
                <div>
                  <p className="text-muted-foreground">Email</p>
                  <p className="font-medium">{technician.email}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">Status</p>
                <p className="font-medium">{technician.active ? 'Active' : 'Inactive'}</p>
              </div>
            </div>

            {technician.skills.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {technician.skills.map((skill) => (
                      <Badge key={skill} variant="secondary" className="rounded-full text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {technician.serviceAreas.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Service Areas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {technician.serviceAreas.map((area) => (
                      <Badge key={area} variant="outline" className="rounded-full text-xs">
                        {area}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Stats card */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Total jobs</span>
                <span className="font-semibold">{totalJobs}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Completed</span>
                <span className="font-semibold">{completedTotal}</span>
              </div>
              <Separator />
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Completion rate</span>
                <span className="font-semibold">{completionRate}%</span>
              </div>
            </CardContent>
          </Card>

          {/* Availability */}
          {technician.availability.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Availability</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 text-sm">
                  {technician.availability
                    .filter((a) => a.active)
                    .map((a) => (
                      <div key={a.id} className="flex justify-between">
                        <span className="text-muted-foreground">{DAY_NAMES[a.dayOfWeek]}</span>
                        <span>
                          {a.startTime} – {a.endTime}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Recent jobs table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Jobs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-b-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="hidden sm:table-cell">Customer</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {technician.jobs.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No jobs assigned yet.
                    </TableCell>
                  </TableRow>
                )}
                {technician.jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(job.createdAt), 'd MMM yyyy')}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {job.booking.service.name}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {/* Customer name available via booking relation if needed */}
                      —
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={jobStatusVariant(job.status)}
                        className="rounded-full text-xs"
                      >
                        {formatJobStatus(job.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
