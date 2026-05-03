// ─── Provider: Profile ────────────────────────────────────────────────────────
// Editable name/email + per-day availability schedule + sign out.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { getCities } from '@/lib/location-nodes'
import { SignOutButton } from '@/components/technician/SignOutButton'
import { PushSubscribeButton } from '@/components/technician/PushSubscribeButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProviderTrustNote } from '@/components/shared/provider-trust-note'
import { ServiceAreaPicker } from '@/components/provider/ServiceAreaPicker'
import { SkillPicker } from '@/components/provider/SkillPicker'
import { normaliseLocationDisplayName } from '@/lib/location-format'

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

async function updateProfile(formData: FormData) {
  'use server'
  const { requireProvider: getSession } = await import('@/lib/auth')
  const session = await getSession()

  const { db: dbServer } = await import('@/lib/db')
  const provider = await dbServer.provider.findUnique({
    where: { userId: session.id },
  })
  if (!provider) return

  const name  = (formData.get('name')  as string | null)?.trim()
  const email = (formData.get('email') as string | null)?.trim()
  const bio = (formData.get('bio') as string | null)?.trim()
  const experience = (formData.get('experience') as string | null)?.trim()
  const evidenceNote = (formData.get('evidenceNote') as string | null)?.trim()
  const skillTags = formData.getAll('skillTags').map(String)
  const portfolioUrlsInput = (formData.get('portfolioUrls') as string | null)?.trim() ?? ''
  const portfolioUrls = portfolioUrlsInput
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)

  // Update profile fields
  if (
    name ||
    email !== undefined ||
    bio !== undefined ||
    experience !== undefined ||
    evidenceNote !== undefined ||
    skillTags.length >= 0 ||
    portfolioUrlsInput !== undefined
  ) {
    const { syncProviderSkills } = await import('@/lib/provider-skills')

    if (skillTags.length === 0) {
      redirect('/provider/profile?error=skills_required')
    }

    await dbServer.provider.update({
      where: { id: provider.id },
      data: {
        ...(name  ? { name }  : {}),
        ...(email !== null && email !== undefined ? { email: email || null } : {}),
        bio: bio || null,
        experience: experience || null,
        evidenceNote: evidenceNote || null,
        portfolioUrls,
      },
    })

    await syncProviderSkills(dbServer, provider.id, skillTags)
  }

  // Sync structured service areas from picker
  if (formData.get('serviceAreasPickerRendered') === '1') {
    const locationNodeIds = formData.getAll('locationNodeIds') as string[]

    // Deactivate structured areas that are no longer in the submitted selection.
    // When locationNodeIds is empty, this deactivates ALL node-linked areas (correct: provider deselected all).
    await dbServer.technicianServiceArea.updateMany({
      where: {
        providerId: provider.id,
        locationNodeId: { not: null },
        ...(locationNodeIds.length > 0 ? { locationNodeId: { notIn: locationNodeIds } } : {}),
      },
      data: { active: false },
    })

    // Upsert submitted service areas
    if (locationNodeIds.length > 0) {
      // Load all node data
      const nodes = await dbServer.locationNode.findMany({
        where: { id: { in: locationNodeIds }, active: true },
        select: { id: true, slug: true, label: true, provinceKey: true, cityKey: true, regionKey: true },
      })

      // Find which IDs already have a row
      const existingAreas = await dbServer.technicianServiceArea.findMany({
        where: {
          providerId: provider.id,
          locationNodeId: { in: locationNodeIds },
        },
        select: { locationNodeId: true },
      })
      const existingNodeIds = new Set(existingAreas.map(a => a.locationNodeId).filter(Boolean))

      const toCreate = nodes.filter(n => !existingNodeIds.has(n.id))
      const toUpdate = nodes.filter(n => existingNodeIds.has(n.id))

      // Reactivate existing rows in bulk
      if (toUpdate.length > 0) {
        await dbServer.technicianServiceArea.updateMany({
          where: {
            providerId: provider.id,
            locationNodeId: { in: toUpdate.map(n => n.id) },
          },
          data: { active: true },
        })
      }

      // Create new rows in bulk
      if (toCreate.length > 0) {
        await dbServer.technicianServiceArea.createMany({
          data: toCreate.map(node => ({
            providerId: provider.id,
            locationNodeId: node.id,
            areaType: 'SUBURB' as const,
            label: normaliseLocationDisplayName(node.label),
            provinceKey: node.provinceKey,
            cityKey: node.cityKey,
            regionKey: node.regionKey,
            suburbKey: node.slug.split('__').at(-1) ?? node.slug,
            active: true,
          })),
          skipDuplicates: true,
        })
      }
    }
  }

  // Upsert schedule for each day
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    const active    = formData.get(`day_${day}_active`) === 'on'
    const startTime = (formData.get(`day_${day}_start`) as string | null) ?? '08:00'
    const endTime   = (formData.get(`day_${day}_end`)   as string | null) ?? '17:00'

    await dbServer.providerSchedule.upsert({
      where: { providerId_dayOfWeek: { providerId: provider.id, dayOfWeek: day } },
      create: { providerId: provider.id, dayOfWeek: day, startTime, endTime, active },
      update: { startTime, endTime, active },
    })
  }

  const { evaluateAndAwardProviderProfileCompletionPromoCredits } = await import('@/lib/provider-promo-awards')
  await evaluateAndAwardProviderProfileCompletionPromoCredits(provider.id, {
    referenceType: 'provider',
    referenceId: provider.id,
  })

  redirect('/provider/profile')
}

export default async function ProviderProfilePage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  const session = await requireProvider()
  const resolvedSearchParams = searchParams ? await searchParams : {}

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

  const reviews = await db.review.findMany({
    where: {
      reviewerType: 'CUSTOMER',
      jobId: { in: completedJobs.map((job) => job.id) },
    },
    orderBy: { createdAt: 'desc' },
  })

  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length
    : null
  const reviewByJobId = new Map(reviews.map((review) => [review.jobId, review]))

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">My Profile</h1>

      {resolvedSearchParams.error === 'skills_required' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Select at least one skill before saving your profile.
        </div>
      )}

      <form action={updateProfile} className="space-y-6">
        {/* Contact info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <p className="text-sm pt-1">{provider.phone ?? '—'}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Public profile and evidence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                placeholder="Optional: mention past jobs, references, or types of work you are comfortable sharing."
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
          </CardContent>
        </Card>

        {/* Availability schedule */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Availability
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
          </CardContent>
        </Card>

        <Button type="submit" className="w-full">Save changes</Button>
      </form>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Rating &amp; review history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border px-3 py-3 text-center">
              <p className="text-xs text-muted-foreground">Average</p>
              <p className="mt-1 font-semibold">
                {averageRating ? `${averageRating.toFixed(1)} / 5` : '—'}
              </p>
            </div>
            <div className="rounded-lg border px-3 py-3 text-center">
              <p className="text-xs text-muted-foreground">Reviews</p>
              <p className="mt-1 font-semibold">{reviews.length}</p>
            </div>
            <div className="rounded-lg border px-3 py-3 text-center">
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
                  <div key={job.id} className="rounded-lg border px-3 py-3">
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
        </CardContent>
      </Card>

      <PushSubscribeButton />
      <SignOutButton />
    </div>
  )
}
