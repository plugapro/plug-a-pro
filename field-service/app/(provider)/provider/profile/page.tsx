// ─── Provider: Profile ────────────────────────────────────────────────────────
// Editable name/email + per-day availability schedule + sign out.

export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { getCities } from '@/lib/location-nodes'
import { SignOutButton } from '@/components/technician/SignOutButton'
import { PushSubscribeButton } from '@/components/technician/PushSubscribeButton'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProviderTrustNote } from '@/components/shared/provider-trust-note'
import { ServiceAreaPicker } from '@/components/provider/ServiceAreaPicker'
import { SkillPicker } from '@/components/provider/SkillPicker'
import {
  providerApplicationApprovalStatus,
  providerIdentityVerificationStatus,
  type ProviderStatusTone,
} from '@/lib/provider-identity-status'
import { updateProviderProfileFromFormAction } from './actions'

export const metadata = buildMetadata({ title: 'My Profile', noIndex: true })

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

function statusPillStyle(tone: ProviderStatusTone) {
  switch (tone) {
    case 'success':
      return { background: 'rgba(15,162,138,0.12)', color: '#0FA28A' }
    case 'danger':
      return { background: 'rgba(239,68,68,0.12)', color: '#EF4444' }
    case 'info':
      return { background: 'rgba(42,120,240,0.12)', color: '#2A78F0' }
    case 'warning':
      return { background: 'rgba(255,194,43,0.15)', color: '#FFC22B' }
    default:
      return { background: 'rgba(148,163,184,0.14)', color: '#64748B' }
  }
}

export default async function ProviderProfilePage() {
  const session = await requireProvider()

  const [provider, cities] = await Promise.all([
    db.provider.findUnique({
      where: { userId: session.id },
      include: {
        schedule: { orderBy: { dayOfWeek: 'asc' } },
        technicianServiceAreas: {
          where: { active: true, locationNodeId: { not: null } },
          select: { locationNodeId: true, label: true },
        },
      },
    }),
    getCities(),
  ])

  if (!provider) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground">
        <p>Provider account not found.</p>
      </div>
    )
  }

  // Build a quick lookup: dayOfWeek → schedule row
  const scheduleMap = Object.fromEntries(
    provider.schedule.map((s) => [s.dayOfWeek, s])
  )

  // Build selected node IDs and label map for ServiceAreaPicker
  const selectedNodeIds = provider.technicianServiceAreas
    .map(a => a.locationNodeId)
    .filter((id): id is string => id != null)

  const selectedLabels = Object.fromEntries(
    provider.technicianServiceAreas
      .filter((a): a is typeof a & { locationNodeId: string } => a.locationNodeId != null)
      .map(a => [a.locationNodeId, a.label])
  )

  const completedJobs = await db.job.findMany({
    where: {
      providerId: provider.id,
      status: 'COMPLETED',
    },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                include: {
                  customer: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { completedAt: 'desc' },
    take: 20,
  })

  // CJ-02: tolerate reviews written with either key. Legacy /review/[token]
  // rows carry matchId only; legacy /bookings/[id]/rate rows carry jobId only.
  const matchIdToJobId = new Map(
    completedJobs
      .map((job) => [job.booking?.match?.id, job.id] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0])),
  )
  const reviews = await db.review.findMany({
    where: {
      reviewerType: 'CUSTOMER',
      OR: [
        { jobId: { in: completedJobs.map((job) => job.id) } },
        { matchId: { in: [...matchIdToJobId.keys()] } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  })

  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length
    : null
  const reviewByJobId = new Map(
    reviews.map((review) => [
      review.jobId ?? (review.matchId ? matchIdToJobId.get(review.matchId) ?? null : null),
      review,
    ]),
  )
  const applicationStatus = providerApplicationApprovalStatus(provider.verified)
  const identityStatus = providerIdentityVerificationStatus(provider.kycStatus)

  return (
    <div className="pb-32 screen-enter">
      {/* Page header */}
      <div className="px-[18px] pt-[60px] pb-4">
        <div className="text-[28px] font-bold tracking-[-0.025em]" style={{ color: 'var(--ink)' }}>My Profile</div>
      </div>

      {/* Profile hero card */}
      <div className="px-[18px] mb-5">
        <div className="rounded-[20px] p-4 flex items-center gap-4"
             style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-[20px] font-bold text-white shrink-0"
               style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)' }}>
            {provider.name ? provider.name.split(' ').map((s: string) => s[0]).slice(0, 2).join('') : 'P'}
          </div>
          <div>
            <div className="text-[16px] font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
              {provider.name ?? 'Provider'}
            </div>
            <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>{provider.phone ?? '-'}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span
                className="inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-bold uppercase tracking-[0.04em]"
                style={statusPillStyle(applicationStatus.tone)}
                title={applicationStatus.description}
              >
                {applicationStatus.label}
              </span>
              <span
                className="inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-bold uppercase tracking-[0.04em]"
                style={statusPillStyle(identityStatus.tone)}
                title={identityStatus.description}
              >
                {identityStatus.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-[18px]">
        <ActionForm
          action={updateProviderProfileFromFormAction}
          successMessage="Profile updated"
          errorFallback="Could not save your changes. Please try again."
          refreshOnSuccess
          className="space-y-4"
        >
          {/* Contact info */}
          <div className="rounded-[20px] overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="px-4 pt-4 pb-1">
              <div className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: 'var(--ink-mute)' }}>Contact</div>
            </div>
            <div className="px-4 pb-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm">Name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={provider.name ?? ''}
                  placeholder="Your name"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={provider.email ?? ''}
                  placeholder="your@email.com"
                  className="h-9"
                />
              </div>
              <div className="space-y-1 text-sm">
                <span className="text-muted-foreground text-sm">Phone</span>
                <p className="text-sm pt-1">{provider.phone ?? '-'}</p>
              </div>
            </div>
          </div>

          {/* Public profile and evidence */}
          <div className="rounded-[20px] overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="px-4 pt-4 pb-1">
              <div className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: 'var(--ink-mute)' }}>Public profile and evidence</div>
            </div>
            <div className="px-4 pb-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bio" className="text-sm">Bio</Label>
                <Textarea
                  id="bio"
                  name="bio"
                  defaultValue={provider.bio ?? ''}
                  rows={3}
                  placeholder="Tell customers what kind of work you do."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="experience" className="text-sm">Experience</Label>
                <Input
                  id="experience"
                  name="experience"
                  defaultValue={provider.experience ?? ''}
                  placeholder="Example: 3–5 years"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Skills</Label>
                <p className="text-xs text-muted-foreground">
                  Select all the services you want to receive jobs for.
                </p>
                <SkillPicker initialSkillLabels={provider.skills} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Service areas</Label>
                <p className="text-xs text-muted-foreground">
                  Select the suburbs where you offer services.
                </p>
                <ServiceAreaPicker
                  initialCities={cities}
                  selectedNodeIds={selectedNodeIds}
                  selectedLabels={selectedLabels}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evidenceNote" className="text-sm">Provider evidence note</Label>
                <Textarea
                  id="evidenceNote"
                  name="evidenceNote"
                  defaultValue={provider.evidenceNote ?? ''}
                  rows={4}
                  placeholder="Optional: mention past jobs, references or types of work you are comfortable sharing."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portfolioUrls" className="text-sm">Portfolio links</Label>
                <Textarea
                  id="portfolioUrls"
                  name="portfolioUrls"
                  defaultValue={provider.portfolioUrls.join('\n')}
                  rows={3}
                  placeholder="Optional: one link per line to examples of your work."
                />
              </div>
              <ProviderTrustNote marketplaceApproved={provider.verified} />
            </div>
          </div>

          {/* Availability schedule */}
          <div className="rounded-[20px] overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="px-4 pt-4 pb-1">
              <div className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: 'var(--ink-mute)' }}>Availability</div>
            </div>
            <div className="px-4 pb-4 space-y-4">
              {DAYS.map(({ value: day, label }) => {
                const entry     = scheduleMap[day]
                const isActive  = entry?.active  ?? (day >= 1 && day <= 5)
                const startTime = entry?.startTime ?? '08:00'
                const endTime   = entry?.endTime   ?? '17:00'

                return (
                  <div key={day} className="flex items-center gap-3">
                    {/* Active toggle */}
                    <label className="flex items-center gap-2 w-28 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name={`day_${day}_active`}
                        defaultChecked={isActive}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      <span className="text-sm">{label.slice(0, 3)}</span>
                    </label>

                    {/* Time inputs */}
                    <input
                      type="time"
                      name={`day_${day}_start`}
                      defaultValue={startTime}
                      className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <input
                      type="time"
                      name={`day_${day}_end`}
                      defaultValue={endTime}
                      className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <SubmitButton className="w-full" pendingLabel="Saving...">Save changes</SubmitButton>
        </ActionForm>
      </div>

      {/* Rating & review history */}
      <div className="px-[18px] mt-4">
        <div className="rounded-[20px] overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div className="px-4 pt-4 pb-1">
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: 'var(--ink-mute)' }}>Rating &amp; review history</div>
          </div>
          <div className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-[12px] px-3 py-3 text-center" style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                <p className="text-xs text-muted-foreground">Average</p>
                <p className="mt-1 font-semibold">
                  {averageRating ? `${averageRating.toFixed(1)} / 5` : '-'}
                </p>
              </div>
              <div className="rounded-[12px] px-3 py-3 text-center" style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                <p className="text-xs text-muted-foreground">Reviews</p>
                <p className="mt-1 font-semibold">{reviews.length}</p>
              </div>
              <div className="rounded-[12px] px-3 py-3 text-center" style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                <p className="text-xs text-muted-foreground">Completed jobs</p>
                <p className="mt-1 font-semibold">{completedJobs.length}</p>
              </div>
            </div>

            {completedJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Complete a few jobs and customer reviews will appear here.
              </p>
            ) : (
              <div className="space-y-3">
                {completedJobs.map((job) => {
                  const review = reviewByJobId.get(job.id)
                  return (
                    <div key={job.id} className="rounded-[14px] px-3 py-3" style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium capitalize">
                            {job.booking.match.jobRequest.category}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {job.booking.match.jobRequest.customer.name}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {(job.completedAt ?? job.createdAt).toLocaleDateString('en-ZA', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                      {review ? (
                        <>
                          <p className="mt-2 text-sm">{'★'.repeat(review.score)}{'☆'.repeat(5 - review.score)}</p>
                          {review.comment && (
                            <p className="mt-2 text-sm text-muted-foreground">{review.comment}</p>
                          )}
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No customer review left for this job yet.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Push notifications */}
      <div className="px-[18px] mt-4">
        <PushSubscribeButton />
      </div>

      {/* Appearance */}
      <div className="px-[18px] mt-4">
        <div className="rounded-[20px] overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div className="px-4 pt-4 pb-1">
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: 'var(--ink-mute)' }}>Appearance</div>
          </div>
          <div className="px-4 pb-4">
            <ThemeToggle className="w-full" />
          </div>
        </div>
      </div>

      {/* Sign out */}
      <div className="px-[18px] mt-4">
        <SignOutButton />
      </div>
    </div>
  )
}
