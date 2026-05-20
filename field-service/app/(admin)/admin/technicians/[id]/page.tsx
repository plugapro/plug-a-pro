// ─── Admin: Provider Profile ───────────────────────────────────────────────────
// Full profile view for a single provider: stats, recent jobs, toggle active.

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { evaluateProviderProfileCompleteness } from '@/lib/provider-onboarding-completeness'
import { getHighRiskServiceRequirements } from '@/lib/service-category-policy'
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
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { ArrowLeft } from 'lucide-react'
import { format } from 'date-fns'
import {
  updateProviderProfileFromFormAction,
  addProviderNoteFromFormAction,
  upsertCertificationFromFormAction,
  verifyCertificationFromFormAction,
  upsertEquipmentFromFormAction,
} from './actions'
import {
  ProviderActionsPanel,
  CertificationDeleteButton,
  EquipmentDeleteButton,
} from './_components/ProviderActionsPanel'

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

// ─── Page ─────────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ message?: string }>
}

export default async function ProviderProfilePage({ params, searchParams }: Props) {
  const { id } = await params
  const query = (await searchParams) ?? {}

  const admin = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.providers', { userId: admin.id })

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
        select: {
          id: true,
          body: true,
          pinned: true,
          authorId: true,
          createdAt: true,
          reasonCode: true,
          strikeDelta: true,
        },
      },
      adminCertifications: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, issuingAuthority: true, certNumber: true,
          issuedAt: true, expiresAt: true, verifiedAt: true, notes: true,
        },
      },
      equipment: {
        where: { active: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, label: true, category: true, serialNumber: true },
      },
      technicianServiceAreas: {
        orderBy: [{ active: 'desc' }, { label: 'asc' }],
        select: { id: true, label: true, city: true, active: true, areaType: true },
      },
      _count: {
        select: {
          jobs: true,
        },
      },
    },
  })

  if (!provider) notFound()

  const auditEvents = await db.adminAuditEvent.findMany({
    where: {
      OR: [
        { entityType: 'Provider', entityId: provider.id },
        ...provider.providerNotes.map((note) => ({
          entityType: 'ProviderNote',
          entityId: note.id,
        })),
        ...provider.adminCertifications.map((cert) => ({
          entityType: 'ProviderCertification',
          entityId: cert.id,
        })),
        ...provider.equipment.map((equipment) => ({
          entityType: 'ProviderEquipment',
          entityId: equipment.id,
        })),
      ],
    },
    include: {
      admin: {
        select: {
          name: true,
          role: true,
          email: true,
        },
      },
    },
    orderBy: { timestamp: 'desc' },
    take: 20,
  })

  const latestApplication = await db.providerApplication.findFirst({
    where: { phone: provider.phone },
    orderBy: { submittedAt: 'desc' },
    select: {
      evidenceFileUrls: true,
      evidenceNote: true,
      skills: true,
      callOutFee: true,
      hourlyRate: true,
      rateNegotiable: true,
      experience: true,
      availability: true,
      idNumber: true,
      attachments: {
        where: { label: { in: ['evidence', 'provider_certification', 'provider_id_document', 'provider_id_selfie'] } },
        select: { id: true, label: true, mimeType: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  const allApplicationAttachments = latestApplication?.attachments ?? []
  const evidenceAttachments = allApplicationAttachments.filter((a) => a.label === 'evidence')
  const certificationAttachments = allApplicationAttachments.filter((a) => a.label === 'provider_certification')
  const idDocAttachments = allApplicationAttachments.filter((a) =>
    a.label === 'provider_id_document' || a.label === 'provider_id_selfie'
  )
  const highRiskRequirements = getHighRiskServiceRequirements(latestApplication?.skills ?? provider.skills)

  const completeness = evaluateProviderProfileCompleteness({
    name: provider.name,
    phone: provider.phone,
    email: provider.email,
    skills: provider.skills,
    serviceAreas: provider.serviceAreas,
    experience: latestApplication?.experience ?? provider.experience,
    availability: latestApplication?.availability ?? null,
    callOutFee: latestApplication?.callOutFee ? Number(latestApplication.callOutFee) : null,
    hourlyRate: latestApplication?.hourlyRate ? Number(latestApplication.hourlyRate) : null,
    rateNegotiable: latestApplication?.rateNegotiable ?? null,
    evidenceFileCount: latestApplication?.evidenceFileUrls?.length ?? 0,
    evidenceNote: latestApplication?.evidenceNote ?? null,
    idNumber: latestApplication?.idNumber ?? null,
    avatarUrl: provider.avatarUrl,
  })

  const totalJobs = provider._count.jobs
  const completedTotal = await db.job.count({
    where: { providerId: id, status: 'COMPLETED' },
  })
  const completionRate =
    totalJobs > 0 ? Math.round((completedTotal / totalJobs) * 100) : 0

  const activeJob = provider.jobs.find((j) =>
    ['EN_ROUTE', 'ARRIVED', 'STARTED', 'AWAITING_APPROVAL'].includes(j.status)
  )

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
      </div>

      {query.message && (
        <div className="tone-success rounded-lg border px-4 py-2 text-sm">
          {query.message}
        </div>
      )}

      {provider.suspendedUntil && provider.suspendedUntil > new Date() && (
        <div className="tone-warning rounded-lg border px-4 py-3 text-sm">
          <p className="font-medium">
            Provider suspended until{' '}
            {provider.suspendedUntil.toLocaleString('en-ZA', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          {provider.suspendedReason && (
            <p className="mt-1">{provider.suspendedReason}</p>
          )}
        </div>
      )}

      {/* ── Profile completeness panel ──────────────────────────────────────── */}
      {!completeness.ok && (
        <Card className={
          completeness.canApprove
            ? completeness.canShowToCustomers
              ? 'border-slate-200'
              : ''
            : 'border-rose-200 bg-rose-50/40'
        }>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {completeness.canApprove ? (
                completeness.canShowToCustomers ? (
                  <span className="text-slate-700">📋 Profile completeness — recommended fields missing</span>
                ) : (
                  <span className="text-amber-800">⚠️ Profile completeness — customer-display gaps</span>
                )
              ) : (
                <span className="text-rose-800">⛔ Profile completeness — approval blockers</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1.5 text-sm">
              {completeness.missing.map((entry) => (
                <li key={entry.field} className="flex items-start gap-2">
                  <Badge
                    variant="outline"
                    className={
                      entry.severity === 'block_submit' || entry.severity === 'block_approve'
                        ? 'border-rose-300 bg-rose-100 text-rose-800'
                        : entry.severity === 'block_customer_display'
                        ? 'tone-warning'
                        : 'tone-neutral'
                    }
                  >
                    {entry.severity === 'block_submit' ? 'BLOCKS SUBMIT'
                      : entry.severity === 'block_approve' ? 'BLOCKS APPROVAL'
                      : entry.severity === 'block_customer_display' ? 'HIDES FROM CUSTOMERS'
                      : 'RECOMMENDED'}
                  </Badge>
                  <div className="flex-1">
                    <span className="font-medium text-slate-900">{entry.field}</span>
                    <span className="text-slate-600"> — {entry.reason}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              {completeness.canApprove
                ? 'Approval is permitted but the customer shortlist card will be incomplete until these fields are filled. Source of truth: lib/provider-onboarding-completeness.ts'
                : 'Required fields must be filled before this provider can be approved.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Flag banner ──────────────────────────────────────────────────────── */}
      {!crudEnabled && (
        <div className="tone-warning rounded-lg border px-4 py-2 text-sm">
          Provider mutations are disabled. Enable the <code>admin.crud.providers</code> feature flag to verify, suspend, or update providers.
        </div>
      )}

      {/* ── Admin actions ───────────────────────────────────────────────────── */}
      <ProviderActionsPanel
        providerId={provider.id}
        providerName={provider.name}
        providerPhone={provider.phone}
        active={provider.active}
        currentStatus={provider.status}
        currentKycStatus={provider.kycStatus}
        isVerified={provider.verified}
        crudEnabled={crudEnabled}
        adminRole={admin.adminRole}
      />

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
                <p className="text-muted-foreground">KYC status</p>
                <p className="font-medium">{provider.kycStatus.replace(/_/g, ' ')}</p>
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
              Skills and service areas are supplied by the provider. This flag only controls whether the application passed Plug A Pro&apos;s marketplace review for lead eligibility.
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

            {highRiskRequirements.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">High-risk service review</p>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {highRiskRequirements.map((requirement) => (
                        <Badge key={requirement.serviceKey} variant="destructive" className="rounded-full text-xs">
                          {requirement.label} — {requirement.riskLevel === 'regulated' ? 'Regulated' : 'High risk'}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Certification proof is provider-supplied until an admin records a verified certification decision. Do not show certification claims to customers unless reviewed.
                    </p>
                    <p className="text-sm">
                      Certification proof: <span className="font-medium">{certificationAttachments.length > 0 ? 'Submitted' : 'Not added yet'}</span>
                    </p>
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

            {provider.technicianServiceAreas.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Structured Coverage Status</p>
                  <div className="flex flex-wrap gap-1.5">
                    {provider.technicianServiceAreas.map((area) => (
                      <Badge
                        key={area.id}
                        variant={area.active ? 'default' : 'outline'}
                        className="rounded-full text-xs"
                      >
                        {area.label} — {area.active ? 'Active pilot' : 'Coming soon'}
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
                    This note is supplied by the provider. It does not become a verified claim unless Plug A Pro reviews a specific item and labels it as such.
                  </p>
                </div>
              </>
            )}

            {evidenceAttachments.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Evidence files (uploaded via WhatsApp)</p>
                  <div className="space-y-2">
                    {evidenceAttachments.map((att, i) => (
                      <a
                        key={att.id}
                        href={`/api/attachments/${att.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm text-primary hover:underline"
                      >
                        {att.mimeType.startsWith('image/') ? '🖼' : '📄'} File {i + 1} — {att.mimeType}
                      </a>
                    ))}
                  </div>
                </div>
              </>
            )}

            {certificationAttachments.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Certification proof files (private review only)</p>
                  <div className="space-y-2">
                    {certificationAttachments.map((att, i) => (
                      <a
                        key={att.id}
                        href={`/api/attachments/${att.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm text-primary hover:underline"
                      >
                        {att.mimeType.startsWith('image/') ? '🖼' : '📄'} Certification proof {i + 1} — {att.mimeType}
                      </a>
                    ))}
                  </div>
                </div>
              </>
            )}

            {(idDocAttachments.length > 0 || latestApplication?.idNumber) && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Identity verification</p>
                  <div className="space-y-2">
                    {latestApplication?.idNumber && (
                      <p className="text-sm">🪪 ID/passport: <span className="font-mono">{latestApplication.idNumber}</span></p>
                    )}
                    {idDocAttachments.map((att) => {
                      const typeLabel = att.label === 'provider_id_selfie' ? 'Selfie with ID' : 'ID document'
                      return (
                        <a
                          key={att.id}
                          href={`/api/attachments/${att.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-sm text-primary hover:underline"
                        >
                          {att.mimeType.startsWith('image/') ? '🖼' : '📄'} {typeLabel} — {att.mimeType}
                        </a>
                      )
                    })}
                  </div>
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

            {crudEnabled && (
              <>
                <Separator />
                <ActionForm
                  action={updateProviderProfileFromFormAction}
                  successMessage="Provider profile saved"
                  className="grid gap-3 md:grid-cols-2"
                >
                  <input type="hidden" name="providerId" value={id} />
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Name</span>
                    <input
                      name="name"
                      defaultValue={provider.name}
                      className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Phone</span>
                    <input
                      name="phone"
                      defaultValue={provider.phone}
                      className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Email</span>
                    <input
                      name="email"
                      type="email"
                      defaultValue={provider.email ?? ''}
                      className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Experience</span>
                    <input
                      name="experience"
                      defaultValue={provider.experience ?? ''}
                      className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="grid gap-1 text-sm md:col-span-2">
                    <span className="text-muted-foreground">Skills</span>
                    <input
                      name="skills"
                      defaultValue={provider.skills.join(', ')}
                      className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="grid gap-1 text-sm md:col-span-2">
                    <span className="text-muted-foreground">Service areas</span>
                    <input
                      name="serviceAreas"
                      defaultValue={provider.serviceAreas.join(', ')}
                      className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <div className="md:col-span-2">
                    <SubmitButton type="submit" variant="outline" size="sm">
                      Save provider profile
                    </SubmitButton>
                  </div>
                </ActionForm>
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
          <CardTitle className="text-base">Certifications ({provider.adminCertifications.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {provider.adminCertifications.length === 0 ? (
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
                {provider.adminCertifications.map((cert) => (
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
                        <div className="flex justify-end gap-2">
                          {!cert.verifiedAt && (
                            <ActionForm action={verifyCertificationFromFormAction} successMessage="Certification verified" refreshOnSuccess>
                              <input type="hidden" name="certId" value={cert.id} />
                              <input type="hidden" name="providerId" value={id} />
                              <SubmitButton type="submit" variant="ghost" size="sm" className="text-xs h-7">
                                Verify
                              </SubmitButton>
                            </ActionForm>
                          )}
                          <details className="rounded-md border px-2 py-1">
                            <summary className="cursor-pointer text-xs">Edit</summary>
                            <ActionForm action={upsertCertificationFromFormAction} successMessage="Certification saved" refreshOnSuccess className="mt-2 grid gap-2 text-left">
                              <input type="hidden" name="providerId" value={id} />
                              <input type="hidden" name="certId" value={cert.id} />
                              <input
                                name="name"
                                defaultValue={cert.name}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              />
                              <input
                                name="issuingAuthority"
                                defaultValue={cert.issuingAuthority ?? ''}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              />
                              <input
                                name="certNumber"
                                defaultValue={cert.certNumber ?? ''}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              />
                              <input
                                type="date"
                                name="issuedAt"
                                defaultValue={cert.issuedAt ? format(new Date(cert.issuedAt), 'yyyy-MM-dd') : ''}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              />
                              <input
                                type="date"
                                name="expiresAt"
                                defaultValue={cert.expiresAt ? format(new Date(cert.expiresAt), 'yyyy-MM-dd') : ''}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              />
                              <textarea
                                name="notes"
                                rows={2}
                                defaultValue={cert.notes ?? ''}
                                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                              />
                              <SubmitButton type="submit" variant="outline" size="sm" className="h-7 text-xs">
                                Save
                              </SubmitButton>
                            </ActionForm>
                          </details>
                          <CertificationDeleteButton
                            providerId={id}
                            certId={cert.id}
                            certName={cert.name}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {crudEnabled && (
          <CardContent className="border-t pt-4">
            <ActionForm action={upsertCertificationFromFormAction} successMessage="Certification added" resetOnSuccess refreshOnSuccess className="grid gap-3 md:grid-cols-2">
              <input type="hidden" name="providerId" value={id} />
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Certification name</span>
                <input
                  name="name"
                  required
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Issuing authority</span>
                <input
                  name="issuingAuthority"
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Certification number</span>
                <input
                  name="certNumber"
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Issued at</span>
                <input
                  type="date"
                  name="issuedAt"
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Expires at</span>
                <input
                  type="date"
                  name="expiresAt"
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">Notes</span>
                <textarea
                  name="notes"
                  rows={3}
                  className="rounded-md border border-input bg-background px-3 py-2 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="md:col-span-2">
                <SubmitButton type="submit" variant="outline" size="sm">Add certification</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        )}
      </Card>

      {/* ── Equipment ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Equipment ({provider.equipment.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {provider.equipment.length === 0 ? (
            <p className="text-sm text-muted-foreground">No equipment recorded.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {provider.equipment.map((eq) => (
                <div key={eq.id} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                  <span>
                    {eq.label}{eq.category ? ` · ${eq.category}` : ''}{eq.serialNumber ? ` · ${eq.serialNumber}` : ''}
                  </span>
                  {crudEnabled && (
                    <details className="rounded-md border px-2 py-1">
                      <summary className="cursor-pointer text-xs">Edit</summary>
                      <ActionForm action={upsertEquipmentFromFormAction} successMessage="Equipment saved" refreshOnSuccess className="mt-2 grid gap-2 text-left">
                        <input type="hidden" name="equipmentId" value={eq.id} />
                        <input type="hidden" name="providerId" value={id} />
                        <input
                          name="label"
                          defaultValue={eq.label}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        />
                        <input
                          name="category"
                          defaultValue={eq.category ?? ''}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        />
                        <input
                          name="serialNumber"
                          defaultValue={eq.serialNumber ?? ''}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        />
                        <SubmitButton type="submit" variant="outline" size="sm" className="h-7 text-xs">
                          Save
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                  {crudEnabled && (
                    <EquipmentDeleteButton
                      providerId={id}
                      equipmentId={eq.id}
                      equipmentLabel={eq.label}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
        {crudEnabled && (
          <CardContent className="border-t pt-4">
            <ActionForm action={upsertEquipmentFromFormAction} successMessage="Equipment added" resetOnSuccess refreshOnSuccess className="grid gap-3 md:grid-cols-3">
              <input type="hidden" name="providerId" value={id} />
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Label</span>
                <input
                  name="label"
                  required
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Category</span>
                <input
                  name="category"
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Serial number</span>
                <input
                  name="serialNumber"
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="md:col-span-3">
                <SubmitButton type="submit" variant="outline" size="sm">Add equipment</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        )}
      </Card>

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
            <div key={note.id} className={`rounded-md border p-3 text-sm ${note.pinned ? 'tone-warning' : ''}`}>
              <p>{note.body}</p>
              {(note.reasonCode || note.strikeDelta > 0) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {note.reasonCode ?? 'ADMIN_CORRECTION'}
                  {note.strikeDelta > 0 ? ` · strike +${note.strikeDelta}` : ''}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {note.createdAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                {note.pinned && <span className="ml-2 font-medium">pinned</span>}
              </p>
            </div>
          ))}
          {crudEnabled && (
            <div className="grid gap-3 pt-2 border-t">
              <ActionForm
                action={addProviderNoteFromFormAction}
                successMessage="Note added"
                resetOnSuccess
                refreshOnSuccess
                className="flex gap-2"
              >
                <input type="hidden" name="providerId" value={id} />
                <input
                  name="body"
                  required
                  placeholder="Add a note…"
                  className="h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring flex-1"
                />
                <SubmitButton type="submit" variant="outline" size="sm">Add note</SubmitButton>
              </ActionForm>
            </div>
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Audit Trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {auditEvents.length === 0 ? (
            <p className="text-muted-foreground">No audit events yet.</p>
          ) : (
            auditEvents.map((event) => (
              <div key={event.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full text-[11px]">
                      {event.entityType}
                    </Badge>
                    <span className="font-medium">{event.action}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {event.timestamp.toLocaleString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.admin.name} · {event.admin.role} · {event.admin.email}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
