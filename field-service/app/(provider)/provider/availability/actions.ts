'use server'

import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { recordAuditLog } from '@/lib/audit'
import { AUDIT_ENTITY } from '@/lib/audit-entities'

type ActionResult = { ok: true; message: string } | { ok: false; error: string }
type AvailabilityMode = 'ALWAYS_AVAILABLE' | 'SCHEDULE' | 'PAUSED'

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
] as const

function parseAvailabilityMode(raw: FormDataEntryValue | null): AvailabilityMode {
  const value = String(raw ?? 'ALWAYS_AVAILABLE')
  if (value === 'SCHEDULE' || value === 'PAUSED') return value
  return 'ALWAYS_AVAILABLE'
}

function parsePausedUntil(value: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isStartBeforeEnd(startTime: string, endTime: string): boolean {
  return startTime < endTime
}

export async function saveProviderAvailabilityFromFormAction(formData: FormData): Promise<ActionResult> {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return { ok: false, error: 'Your session expired. Sign in again to continue.' }
  }

  const provider = await db.provider.findFirst({
    where: {
      OR: [
        { userId: session.id },
        ...(session.providerId ? [{ id: session.providerId }] : []),
      ],
    },
    include: { technicianAvailability: true },
  })

  if (!provider) {
    return { ok: false, error: 'Your session expired. Sign in again to continue.' }
  }

  const availabilityMode = parseAvailabilityMode(formData.get('availabilityMode'))
  const emergencyAvailable = formData.get('emergencyAvailable') === 'on'
  const sameDayAvailable = formData.get('sameDayAvailable') === 'on'
  const pauseReason = String(formData.get('pauseReason') ?? '').trim() || null
  const pausedUntilInput = formData.get('pausedUntil') as string | null
  const pausedUntil = availabilityMode === 'PAUSED' ? parsePausedUntil(pausedUntilInput) : null

  if (availabilityMode === 'PAUSED' && pausedUntilInput && !pausedUntil) {
    return { ok: false, error: 'Enter a valid pause-until date and time.' }
  }

  // Validate active schedule rows before any write so the form stays intact on failure.
  for (const day of DAYS) {
    const active = formData.get(`day_${day.value}_active`) === 'on'
    if (!active) continue

    const startTime = String(formData.get(`day_${day.value}_start`) ?? '08:00')
    const endTime = String(formData.get(`day_${day.value}_end`) ?? '17:00')

    if (!isStartBeforeEnd(startTime, endTime)) {
      return {
        ok: false,
        error: `${day.label} working hours are invalid. Set an end time later than the start time.`,
      }
    }
  }

  const now = new Date()
  const isAvailableNow = availabilityMode !== 'PAUSED'

  try {
    // Apply schedule, provider status, and availability mode in one transaction for consistency.
    await db.$transaction(async (tx) => {
      for (const day of DAYS) {
        const active = formData.get(`day_${day.value}_active`) === 'on'
        const startTime = String(formData.get(`day_${day.value}_start`) ?? '08:00')
        const endTime = String(formData.get(`day_${day.value}_end`) ?? '17:00')

        await tx.providerSchedule.upsert({
          where: { providerId_dayOfWeek: { providerId: provider.id, dayOfWeek: day.value } },
          create: { providerId: provider.id, dayOfWeek: day.value, startTime, endTime, active },
          update: { startTime, endTime, active },
        })
      }

      await tx.provider.update({
        where: { id: provider.id },
        data: { availableNow: isAvailableNow },
      })

      await tx.technicianAvailability.upsert({
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
      // Audit failures must not block the primary save path.
      console.error('[provider/availability] audit failed', {
        providerId: provider.id,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    return { ok: true, message: 'Availability saved' }
  } catch (error) {
    console.error('[provider/availability] save failed', {
      providerId: provider.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      ok: false,
      error: 'Your availability was not saved. Check your connection and try again.',
    }
  }
}
