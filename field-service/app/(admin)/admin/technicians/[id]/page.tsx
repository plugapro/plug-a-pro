// ─── Admin: Provider Profile ───────────────────────────────────────────────────
// Full profile view for a single provider: stats, recent jobs, toggle active.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/audit'
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
import {
  setProviderStatusFromFormAction,
  addProviderNoteFromFormAction,
  verifyCertificationFromFormAction,
} from '../../providers/actions'

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata = buildMetadata({ title: 'Provider Profile', noIndex: true })

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
    case 'SCHEDULED':
      return 'outline'
    default:
      return 'secondary'
  }
}

function formatJobStatus(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

// ─── Server action ────────────────────────────────────────────────────────────

async function toggleActive(providerId: string, currentActive: boolean) {
  'use server'
  const admin = await requireAdmin()
  await db.provider.update({
    where: { id: providerId },
    data: { active: !currentActive },
  })
  await recordAuditLog({
    actorId: admin.id,
    actorRole: admin.role,
    action: 'provider.active_toggle',
    entityType: 'provider',
    entityId: providerId,
    before: { active: currentActive },
    after: { active: !currentActive },
  })
  redirect(`/admin/providers/${providerId}`)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProviderProfilePage({ params }: Props) {
  const { id } = await params

  const admin = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.providers', admin.id)

  const provider = await db.provider.findFirst({
    where: { id },
    include: {
      jobs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          booking: {
            include: {
              match: {
                include: {
                  jobRequest: { select: { title: true, category: true } },
                },
              },
            },
          },
        },
      },
      schedule: {
        orderBy: { dayOfWeek: 'asc' },
      },
      providerNotes: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, body: true, pinned: true, authorId: true, createdAt: true },
      },
      providerCertifications: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, issuingAuthority: true, certNumber: true,
          issuedAt: true, expiresAt: true, verifiedAt: true, notes: true,
        },
      },
      providerEquipment: {
        where: { active: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, label: true, category: true, serialNumber: true },
      },
      _count: {
        select: {
          jobs: true,
        },
      },
    },
  })

  if (!provider) notFound()

  // Stats
  const totalJobs = provider._count.jobs
  const completedTotal = await db.job.count({
    where: { providerId: id, status: 'COMPLETED' },
  })
  const completionRate =
    totalJobs > 0 ? Math.round((completedTotal / totalJobs) * 100) : 0

  // Current activity: any non-terminal active job
  const activeJob = provider.jobs.find((j) =>
    ['EN_ROUTE', 'ARRIVED', 'STARTED', 'AWAITING_APPROVAL'].includes(j.status)
  )

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const toggleActiveForProvider = toggleActive.bind(null, provider.id, provider.active)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/providers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{provider.name}</h1>
            <Badge variant="outline" className="rounded-full text-xs shrink-0">
              {provider.status.replace(/_/g, ' ')}
            </Badge>
            {activeJob && (
              <Badge variant="default" className="rounded-full capitalize shrink-0">
                {formatJobStatus(activeJob.status)}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">Provider profile</p>
        </div>
        {!crudEnabled && (
          <form action={toggleActiveForProvider}>
            <Button
              type="submit"
              variant={provider.active ? 'destructive' : 'default'}
              size="sm"
            >
              {provider.active ? 'Deactivate' : 'Activate'}
            </Button>
          </form>
        )}
      </div>

      {/* ── Flag banner ──────────────────────────────────────────────────────── */}
      {!crudEnabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Provider mutations are disabled. Enable the <code>admin.crud.providers</code> feature flag to verify, suspend, or update providers.
        </div>
      )}

      {/* ── Admin actions ───────────────────────────────────────────────────── */}
      {crudEnabled && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Provider Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {/* Verify shortcut */}
            {!provider.verified && (
              <form
                action={async () => {
                  'use server'
                  const { verifyProviderAction } = await import('../../providers/actions')
                  await verifyProviderAction(id)
                }}
              >
                <Button type="submit" variant="default" size="sm">
                  Verify provider &amp; set ACTIVE
                </Button>
              </form>
            )}
            {/* Status change */}
            <form action={setProviderStatusFromFormAction} className="flex flex-wrap gap-2 items-center">
              <input type="hidden" name="providerId" value={id} />
              <select
                name="status"
                defaultValue={provider.status}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="APPLICATION_PENDING">Application Pending</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="ARCHIVED">Archived</option>
                <option value="BANNED">Banned</option>
              </select>
              <input
                name="reason"
                required
                placeholder="Reason…"
                className="h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring w-52"
              />
              <Button type="submit" variant="outline" size="sm">Set status</Button>
            </form>
          </CardContent>
        </Card>
      )}

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
                <p className="font-medium">{provider.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="font-medium">{provider.phone}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Provider status</p>
                <p className="font-medium">{provider.status.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Experience</p>
                <p className="font-medium">{provider.experience ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Approved for matching</p>
                <p className="font-medium">{provider.verified ? 'Yes' : 'No'}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Skills and service areas are supplied by the provider. This flag only controls whether the application passed Plug-A-Pro&apos;s marketplace review for lead eligibility.
            </p>

            {provider.skills.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {provider.skills.map((skill) => (
                      <Badge key={skill} variant="secondary" className="rounded-full text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {provider.serviceAreas.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Service Areas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {provider.serviceAreas.map((area) => (
                      <Badge key={area} variant="outline" className="rounded-full text-xs">
                        {area}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {provider.evidenceNote && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Provider-shared evidence note</p>
                  <p className="text-sm">{provider.evidenceNote}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This note is supplied by the provider. It does not become a verified claim unless Plug-A-Pro reviews a specific item and labels it as such.
                  </p>
                </div>
              </>
            )}

            {provider.portfolioUrls.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Portfolio links</p>
                  <div className="space-y-2">
                    {provider.portfolioUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block break-all text-sm text-primary hover:underline"
                      >
                        {url}
                      </a>
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

          {/* Schedule */}
          {provider.schedule.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Availability</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 text-sm">
                  {provider.schedule
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

      {/* ── Certifications ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Certifications ({provider.providerCertifications.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {provider.providerCertifications.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">No certifications recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Issuer</TableHead>
                  <TableHead className="hidden md:table-cell">Expires</TableHead>
                  <TableHead>Verified</TableHead>
                  {crudEnabled && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {provider.providerCertifications.map((cert) => (
                  <TableRow key={cert.id}>
                    <TableCell className="font-medium text-sm">
                      {cert.name}
                      {cert.certNumber && (
                        <p className="text-xs text-muted-foreground font-mono">{cert.certNumber}</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {cert.issuingAuthority ?? '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {cert.expiresAt
                        ? format(new Date(cert.expiresAt), 'd MMM yyyy')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {cert.verifiedAt ? (
                        <Badge variant="default" className="rounded-full text-xs">
                          Verified {format(new Date(cert.verifiedAt), 'd MMM yyyy')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-full text-xs text-muted-foreground">
                          Unverified
                        </Badge>
                      )}
                    </TableCell>
                    {crudEnabled && (
                      <TableCell className="text-right">
                        {!cert.verifiedAt && (
                          <form action={verifyCertificationFromFormAction}>
                            <input type="hidden" name="certId" value={cert.id} />
                            <input type="hidden" name="providerId" value={id} />
                            <Button type="submit" variant="ghost" size="sm" className="text-xs h-7">
                              Verify
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Equipment ────────────────────────────────────────────────────────── */}
      {provider.providerEquipment.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Equipment ({provider.providerEquipment.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {provider.providerEquipment.map((eq) => (
                <Badge key={eq.id} variant="secondary" className="text-xs">
                  {eq.label}{eq.category ? ` · ${eq.category}` : ''}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Admin notes ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Admin Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {provider.providerNotes.length === 0 && (
            <p className="text-muted-foreground">No notes yet.</p>
          )}
          {provider.providerNotes.map((note) => (
            <div key={note.id} className={`rounded-md border p-3 text-sm ${note.pinned ? 'border-amber-300 bg-amber-50' : ''}`}>
              <p>{note.body}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {note.createdAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                {note.pinned && <span className="ml-2 text-amber-600 font-medium">pinned</span>}
              </p>
            </div>
          ))}
          {crudEnabled && (
            <form action={addProviderNoteFromFormAction} className="flex gap-2 pt-2 border-t">
              <input type="hidden" name="providerId" value={id} />
              <input
                name="body"
                required
                placeholder="Add a note…"
                className="h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring flex-1"
              />
              <Button type="submit" variant="outline" size="sm">Add</Button>
            </form>
          )}
        </CardContent>
      </Card>

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
                  <TableHead>Job Request</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {provider.jobs.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No jobs assigned yet.
                    </TableCell>
                  </TableRow>
                )}
                {provider.jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(job.createdAt), 'd MMM yyyy')}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {job.booking?.match?.jobRequest.title ?? '—'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {job.booking?.match?.jobRequest.category ?? '—'}
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
