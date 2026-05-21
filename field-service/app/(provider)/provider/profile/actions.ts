'use server'

import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { syncProviderSkills } from '@/lib/provider-skills'

type ActionResult = { ok: true; message: string } | { ok: false; error: string }

type ProviderSession = { userId: string; providerId?: string }

const SCHEDULE_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

function parseEmail(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isValidEmail(email: string | null): boolean {
  if (!email) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function toUserSafeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (message.toLowerCase().includes('unique constraint') && message.toLowerCase().includes('email')) {
    return 'That email is already in use. Use a different email and try again.'
  }

  return 'Could not save your changes. Please try again.'
}

async function resolveProviderSession(): Promise<ProviderSession | null> {
  const session = await getSession()
  if (!session || session.role !== 'provider') return null

  return {
    userId: session.id,
    providerId: session.providerId,
  }
}

export async function updateProviderProfileFromFormAction(formData: FormData): Promise<ActionResult> {
  const session = await resolveProviderSession()
  if (!session) {
    return { ok: false, error: 'Your session expired. Sign in again to continue.' }
  }

  const provider = await db.provider.findFirst({
    where: {
      OR: [
        { userId: session.userId },
        ...(session.providerId ? [{ id: session.providerId }] : []),
      ],
    },
    select: { id: true, active: true, status: true },
  })

  if (!provider) {
    return { ok: false, error: 'Your session expired. Sign in again to continue.' }
  }

  if (!provider.active || (provider.status !== 'ACTIVE' && provider.status !== null)) {
    return { ok: false, error: 'Your account is not currently active. Contact support for help.' }
  }

  const name = (formData.get('name') as string | null)?.trim() ?? null
  const email = parseEmail(formData.get('email'))
  const bio = (formData.get('bio') as string | null)?.trim() ?? null
  const experience = (formData.get('experience') as string | null)?.trim() ?? null
  const evidenceNote = (formData.get('evidenceNote') as string | null)?.trim() ?? null
  const skillTags = formData.getAll('skillTags').map(String).map((value) => value.trim()).filter(Boolean)
  const portfolioUrlsInput = (formData.get('portfolioUrls') as string | null)?.trim() ?? ''
  const portfolioUrls = portfolioUrlsInput
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)

  if (!isValidEmail(email)) {
    return { ok: false, error: 'Enter a valid email address before saving.' }
  }

  if (skillTags.length === 0) {
    return { ok: false, error: 'Select at least one skill before saving your profile.' }
  }

  try {
    // Keep profile, skills, areas, and schedule changes atomic so partial saves never leak through.
    await db.$transaction(async (tx) => {
      await tx.provider.update({
        where: { id: provider.id },
        data: {
          ...(name ? { name } : {}),
          email,
          bio,
          experience,
          evidenceNote,
          portfolioUrls,
        },
      })

      await syncProviderSkills(tx, provider.id, skillTags)

      if (formData.get('serviceAreasPickerRendered') === '1') {
        // Service area picker submits structured node IDs; deactivate removed nodes and upsert current ones.
        const locationNodeIds = formData.getAll('locationNodeIds') as string[]

        await tx.technicianServiceArea.updateMany({
          where: {
            providerId: provider.id,
            locationNodeId: { not: null },
            ...(locationNodeIds.length > 0 ? { locationNodeId: { notIn: locationNodeIds } } : {}),
          },
          data: { active: false },
        })

        if (locationNodeIds.length > 0) {
          const nodes = await tx.locationNode.findMany({
            where: { id: { in: locationNodeIds }, active: true },
            select: { id: true, slug: true, label: true, provinceKey: true, cityKey: true, regionKey: true },
          })

          const existingAreas = await tx.technicianServiceArea.findMany({
            where: {
              providerId: provider.id,
              locationNodeId: { in: locationNodeIds },
            },
            select: { locationNodeId: true },
          })

          const existingNodeIds = new Set(existingAreas.map((area) => area.locationNodeId).filter(Boolean))
          const toCreate = nodes.filter((node) => !existingNodeIds.has(node.id))
          const toUpdate = nodes.filter((node) => existingNodeIds.has(node.id))

          if (toUpdate.length > 0) {
            await tx.technicianServiceArea.updateMany({
              where: {
                providerId: provider.id,
                locationNodeId: { in: toUpdate.map((node) => node.id) },
              },
              data: { active: true },
            })
          }

          if (toCreate.length > 0) {
            await tx.technicianServiceArea.createMany({
              data: toCreate.map((node) => ({
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

      for (const day of SCHEDULE_DAYS) {
        // Persist the full weekly schedule every time so server state matches the submitted form exactly.
        const active = formData.get(`day_${day}_active`) === 'on'
        const startTime = (formData.get(`day_${day}_start`) as string | null) ?? '08:00'
        const endTime = (formData.get(`day_${day}_end`) as string | null) ?? '17:00'

        await tx.providerSchedule.upsert({
          where: { providerId_dayOfWeek: { providerId: provider.id, dayOfWeek: day } },
          create: { providerId: provider.id, dayOfWeek: day, startTime, endTime, active },
          update: { startTime, endTime, active },
        })
      }
    })

    return { ok: true, message: 'Profile updated' }
  } catch (error) {
    console.error('[provider/profile] update failed', {
      providerId: provider.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, error: toUserSafeError(error) }
  }
}
