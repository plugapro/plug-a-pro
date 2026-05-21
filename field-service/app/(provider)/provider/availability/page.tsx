export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveProviderAvailabilityFromFormAction } from './actions'

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

export default async function ProviderAvailabilityPage() {
  const session = await requireProvider()
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
      <div className="px-4 py-8 text-center" style={{ color: 'var(--ink-mute)' }}>
        <p>Your provider account is not yet set up.</p>
      </div>
    )
  }

  const availability = provider.technicianAvailability
  const currentMode = availability?.availabilityMode ?? 'ALWAYS_AVAILABLE'
  const scheduleMap = Object.fromEntries(provider.schedule.map((row) => [row.dayOfWeek, row]))

  return (
    <div className="min-h-screen pb-32 screen-enter">
      <div className="px-[18px] pt-[60px] pb-4">
        <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-1" style={{ color: 'var(--brand-purple)' }}>
          Settings
        </p>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]" style={{ color: 'var(--ink)' }}>
          Availability
        </h1>
        <p className="text-[14px] mt-1" style={{ color: 'var(--ink-mute)' }}>
          Control whether you receive new leads. Existing accepted jobs are not affected.
        </p>
      </div>

      <ActionForm
        action={saveProviderAvailabilityFromFormAction}
        successMessage="Availability saved"
        errorFallback="Your availability was not saved. Check your connection and try again."
        refreshOnSuccess
        className="px-[18px] space-y-4"
      >
        {/* Lead Availability */}
        <div
          className="rounded-[20px]"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: 'var(--ink-mute)' }}>
              Lead Availability
            </p>
          </div>
          <div className="px-5 pb-5 space-y-3">
            <label
              className="flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-colors has-[:checked]:bg-[rgba(139,63,232,0.06)]"
              style={{ border: '1px solid var(--border)', background: 'var(--card-alt)' }}
            >
              <input
                type="radio"
                name="availabilityMode"
                value="ALWAYS_AVAILABLE"
                defaultChecked={currentMode === 'ALWAYS_AVAILABLE'}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium" style={{ color: 'var(--ink)' }}>Always available</span>
                <span className="block text-sm" style={{ color: 'var(--ink-mute)' }}>
                  Receive matching leads whenever you are active.
                </span>
              </span>
            </label>
            <label
              className="flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-colors has-[:checked]:bg-[rgba(139,63,232,0.06)]"
              style={{ border: '1px solid var(--border)', background: 'var(--card-alt)' }}
            >
              <input
                type="radio"
                name="availabilityMode"
                value="SCHEDULE"
                defaultChecked={currentMode === 'SCHEDULE'}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium" style={{ color: 'var(--ink)' }}>Set working hours</span>
                <span className="block text-sm" style={{ color: 'var(--ink-mute)' }}>
                  Use your weekly schedule to control lead eligibility.
                </span>
              </span>
            </label>
            <label
              className="flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-colors has-[:checked]:bg-[rgba(139,63,232,0.06)]"
              style={{ border: '1px solid var(--border)', background: 'var(--card-alt)' }}
            >
              <input
                type="radio"
                name="availabilityMode"
                value="PAUSED"
                defaultChecked={currentMode === 'PAUSED'}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium" style={{ color: 'var(--ink)' }}>Paused</span>
                <span className="block text-sm" style={{ color: 'var(--ink-mute)' }}>
                  Stop receiving new leads until you reactivate.
                </span>
              </span>
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <label
                className="flex items-center gap-2 rounded-xl p-3 text-sm"
                style={{ border: '1px solid var(--border)', background: 'var(--card-alt)' }}
              >
                <input
                  type="checkbox"
                  name="emergencyAvailable"
                  defaultChecked={availability?.emergencyAvailable ?? false}
                  className="size-4 rounded border-input accent-primary"
                />
                <span style={{ color: 'var(--ink)' }}>Available for emergency jobs</span>
              </label>
              <label
                className="flex items-center gap-2 rounded-xl p-3 text-sm"
                style={{ border: '1px solid var(--border)', background: 'var(--card-alt)' }}
              >
                <input
                  type="checkbox"
                  name="sameDayAvailable"
                  defaultChecked={availability?.sameDayAvailable ?? true}
                  className="size-4 rounded border-input accent-primary"
                />
                <span style={{ color: 'var(--ink)' }}>Accept same-day jobs</span>
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
          </div>
        </div>

        {/* Weekly Working Hours */}
        <div
          className="rounded-[20px]"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: 'var(--ink-mute)' }}>
              Weekly Working Hours
            </p>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {DAYS.map((day) => {
              const row = scheduleMap[day.value]
              return (
                <div
                  key={day.value}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl p-3 sm:gap-3"
                  style={{ border: '1px solid var(--border)', background: 'var(--card-alt)' }}
                >
                  <label className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>
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
          </div>
        </div>

        {/* Service Areas */}
        <div
          className="rounded-[20px]"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: 'var(--ink-mute)' }}>
              Service Areas
            </p>
          </div>
          <div className="px-5 pb-5 space-y-2 text-sm">
            {provider.technicianServiceAreas.length === 0 ? (
              <p style={{ color: 'var(--ink-mute)' }}>No structured service areas saved yet.</p>
            ) : (
              provider.technicianServiceAreas.map((area) => (
                <div
                  key={area.label}
                  className="flex items-center justify-between rounded-lg px-3 py-2"
                  style={{ border: '1px solid var(--border)' }}
                >
                  <span style={{ color: 'var(--ink)' }}>{area.label}</span>
                  <span
                    className={area.active ? 'font-medium' : ''}
                    style={{ color: area.active ? 'var(--tone-success-fg)' : 'var(--ink-mute)' }}
                  >
                    {area.active ? 'Active pilot' : 'Coming soon'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <FormSubmitButton className="w-full" pendingLabel="Saving...">
          Save Availability
        </FormSubmitButton>
      </ActionForm>
    </div>
  )
}
