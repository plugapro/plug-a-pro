export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { recordAuditLog } from '@/lib/audit'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCallout } from '@/components/shared/AlertCallout'

export const metadata = buildMetadata({ title: 'Availability', noIndex: true })

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

function pauseUntilFromInput(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function saveAvailability(formData: FormData) {
  'use server'

  const session = await requireProvider()
  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    include: { technicianAvailability: true },
  })
  if (!provider) redirect('/provider')

  const mode = String(formData.get('availabilityMode') ?? 'ALWAYS_AVAILABLE')
  const availabilityMode = ['ALWAYS_AVAILABLE', 'SCHEDULE', 'PAUSED'].includes(mode)
    ? mode
    : 'ALWAYS_AVAILABLE'
  const emergencyAvailable = formData.get('emergencyAvailable') === 'on'
  const sameDayAvailable = formData.get('sameDayAvailable') === 'on'
  const pauseReason = String(formData.get('pauseReason') ?? '').trim() || null
  const pausedUntil = availabilityMode === 'PAUSED'
    ? pauseUntilFromInput(formData.get('pausedUntil') as string | null)
    : null
  const now = new Date()
  const isAvailableNow = availabilityMode !== 'PAUSED'

  for (const day of DAYS) {
    const active = formData.get(`day_${day.value}_active`) === 'on'
    const startTime = String(formData.get(`day_${day.value}_start`) ?? '08:00')
    const endTime = String(formData.get(`day_${day.value}_end`) ?? '17:00')

    await db.providerSchedule.upsert({
      where: { providerId_dayOfWeek: { providerId: provider.id, dayOfWeek: day.value } },
      create: { providerId: provider.id, dayOfWeek: day.value, startTime, endTime, active },
      update: { startTime, endTime, active },
    })
  }

  await db.provider.update({
    where: { id: provider.id },
    data: { availableNow: isAvailableNow },
  })

  await db.technicianAvailability.upsert({
    where: { providerId: provider.id },
    create: {
      providerId: provider.id,
      availabilityMode,
      availabilityState: availabilityMode === 'PAUSED' ? 'PAUSED' : 'AVAILABLE',
      breakUntil: pausedUntil,
      pausedAt: availabilityMode === 'PAUSED' ? now : null,
      pauseReason: availabilityMode === 'PAUSED' ? pauseReason : null,
      emergencyAvailable,
      sameDayAvailable,
      lastUpdatedBy: provider.id,
      lastUpdatedChannel: 'pwa',
      notes: pauseReason,
    },
    update: {
      availabilityMode,
      availabilityState: availabilityMode === 'PAUSED' ? 'PAUSED' : 'AVAILABLE',
      nextAvailableAt: null,
      breakUntil: pausedUntil,
      pausedAt: availabilityMode === 'PAUSED' ? (provider.technicianAvailability?.pausedAt ?? now) : null,
      pauseReason: availabilityMode === 'PAUSED' ? pauseReason : null,
      emergencyAvailable,
      sameDayAvailable,
      lastUpdatedBy: provider.id,
      lastUpdatedChannel: 'pwa',
      notes: pauseReason,
    },
  })

  await recordAuditLog({
    actorId: provider.id,
    actorRole: 'provider',
    action: 'provider.availability.updated',
    entityType: AUDIT_ENTITY.PROVIDER,
    entityId: provider.id,
    before: {
      availableNow: provider.availableNow,
      availabilityMode: provider.technicianAvailability?.availabilityMode ?? null,
      availabilityState: provider.technicianAvailability?.availabilityState ?? null,
      breakUntil: provider.technicianAvailability?.breakUntil ?? null,
      emergencyAvailable: provider.technicianAvailability?.emergencyAvailable ?? false,
      sameDayAvailable: provider.technicianAvailability?.sameDayAvailable ?? true,
    },
    after: {
      availableNow: isAvailableNow,
      availabilityMode,
      availabilityState: availabilityMode === 'PAUSED' ? 'PAUSED' : 'AVAILABLE',
      breakUntil: pausedUntil,
      emergencyAvailable,
      sameDayAvailable,
      changedChannel: 'pwa',
      traceId: crypto.randomUUID().slice(0, 8),
    },
  }).catch((error) => {
    console.error('[provider/availability] audit failed:', error)
  })

  redirect('/provider/availability?saved=1')
}

export default async function ProviderAvailabilityPage({
  searchParams,
}: {
  searchParams?: Promise<{ saved?: string }>
}) {
  const session = await requireProvider()
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    include: {
      technicianAvailability: true,
      schedule: { orderBy: { dayOfWeek: 'asc' } },
      technicianServiceAreas: {
        select: { label: true, active: true },
        orderBy: { label: 'asc' },
      },
    },
  })

  if (!provider) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground">
        <p>Your provider account is not yet set up.</p>
      </div>
    )
  }

  const availability = provider.technicianAvailability
  const currentMode = availability?.availabilityMode ?? 'ALWAYS_AVAILABLE'
  const scheduleMap = Object.fromEntries(provider.schedule.map((row) => [row.dayOfWeek, row]))
  const statusLabel = currentMode === 'PAUSED'
    ? 'Paused'
    : currentMode === 'SCHEDULE'
      ? 'Schedule-based'
      : 'Available now'

  return (
    <div className="px-4 py-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Availability</h1>
        <p className="text-sm text-muted-foreground">
          Control whether you receive new leads. Existing accepted jobs are not affected.
        </p>
      </div>

      {resolvedSearchParams.saved === '1' && (
        <AlertCallout tone="success">
          Availability saved. Current status: {statusLabel}.
        </AlertCallout>
      )}

      <form action={saveAvailability} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead Availability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-card p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 hover:border-border">
              <input
                type="radio"
                name="availabilityMode"
                value="ALWAYS_AVAILABLE"
                defaultChecked={currentMode === 'ALWAYS_AVAILABLE'}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">Always available</span>
                <span className="block text-sm text-muted-foreground">
                  Receive matching leads whenever you are active.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-card p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 hover:border-border">
              <input
                type="radio"
                name="availabilityMode"
                value="SCHEDULE"
                defaultChecked={currentMode === 'SCHEDULE'}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">Set working hours</span>
                <span className="block text-sm text-muted-foreground">
                  Use your weekly schedule to control lead eligibility.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-card p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 hover:border-border">
              <input
                type="radio"
                name="availabilityMode"
                value="PAUSED"
                defaultChecked={currentMode === 'PAUSED'}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">Paused</span>
                <span className="block text-sm text-muted-foreground">
                  Stop receiving new leads until you reactivate.
                </span>
              </span>
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-xl border border-border/80 bg-card p-3 text-sm">
                <input
                  type="checkbox"
                  name="emergencyAvailable"
                  defaultChecked={availability?.emergencyAvailable ?? false}
                  className="size-4 rounded border-input accent-primary"
                />
                Available for emergency jobs
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-border/80 bg-card p-3 text-sm">
                <input
                  type="checkbox"
                  name="sameDayAvailable"
                  defaultChecked={availability?.sameDayAvailable ?? true}
                  className="size-4 rounded border-input accent-primary"
                />
                Accept same-day jobs
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pausedUntil">Pause until</Label>
                <Input
                  id="pausedUntil"
                  name="pausedUntil"
                  type="datetime-local"
                  defaultValue={availability?.breakUntil ? availability.breakUntil.toISOString().slice(0, 16) : ''}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pauseReason">Pause reason</Label>
                <Input id="pauseReason" name="pauseReason" defaultValue={availability?.pauseReason ?? ''} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weekly Working Hours</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {DAYS.map((day) => {
              const row = scheduleMap[day.value]
              return (
                <div
                  key={day.value}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-border/80 bg-card p-3 sm:gap-3"
                >
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      name={`day_${day.value}_active`}
                      defaultChecked={row?.active ?? (day.value >= 1 && day.value <= 5)}
                      className="size-4 rounded border-input accent-primary"
                    />
                    {day.label}
                  </label>
                  <Input
                    name={`day_${day.value}_start`}
                    type="time"
                    defaultValue={row?.startTime ?? '08:00'}
                    className="w-24 text-center sm:w-28"
                  />
                  <Input
                    name={`day_${day.value}_end`}
                    type="time"
                    defaultValue={row?.endTime ?? '17:00'}
                    className="w-24 text-center sm:w-28"
                  />
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service Areas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {provider.technicianServiceAreas.length === 0 ? (
              <p className="text-muted-foreground">No structured service areas saved yet.</p>
            ) : (
              provider.technicianServiceAreas.map((area) => (
                <div key={area.label} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span>{area.label}</span>
                  <span className={area.active ? 'text-[var(--tone-success-fg)] font-medium' : 'text-muted-foreground'}>
                    {area.active ? 'Active pilot' : 'Coming soon'}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Button type="submit" className="w-full">Save Availability</Button>
      </form>
    </div>
  )
}
