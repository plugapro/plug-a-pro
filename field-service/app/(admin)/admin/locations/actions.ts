'use server'

import { requireAdmin } from '@/lib/auth'
import {
  createLocationNode,
  updateLocationNode,
  deactivateLocationNode,
  deleteLocationNode,
  LocationNodeInUseError,
} from '@/lib/location-nodes'
import { revalidatePath } from 'next/cache'

export async function createLocationNodeAction(input: {
  nodeType: 'PROVINCE' | 'CITY' | 'REGION' | 'SUBURB'
  slug: string
  label: string
  parentId?: string | null
  lat?: number | null
  lng?: number | null
  radiusKm?: number | null
}) {
  await requireAdmin()
  try {
    const node = await createLocationNode({
      nodeType: input.nodeType,
      slug: input.slug,
      label: input.label,
      parentId: input.parentId ?? null,
      lat: input.lat ?? undefined,
      lng: input.lng ?? undefined,
      radiusKm: input.radiusKm ?? undefined,
    })
    revalidatePath('/admin/locations')
    return { ok: true, id: node.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create location' }
  }
}

export async function updateLocationNodeAction(id: string, input: {
  label?: string
  lat?: number | null
  lng?: number | null
  radiusKm?: number | null
}) {
  await requireAdmin()
  try {
    await updateLocationNode(id, input)
    revalidatePath('/admin/locations')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update location' }
  }
}

export async function deactivateLocationNodeAction(id: string) {
  await requireAdmin()
  try {
    await deactivateLocationNode(id)
    revalidatePath('/admin/locations')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to deactivate location' }
  }
}

export async function deleteLocationNodeAction(id: string) {
  await requireAdmin()
  try {
    await deleteLocationNode(id)
    revalidatePath('/admin/locations')
    return { ok: true }
  } catch (err) {
    if (err instanceof LocationNodeInUseError) {
      // Try soft-delete instead
      try {
        await deactivateLocationNode(id)
        revalidatePath('/admin/locations')
        return { ok: true, softDeleted: true }
      } catch (deactivateErr) {
        return { ok: false, error: deactivateErr instanceof Error ? deactivateErr.message : 'Failed to deactivate' }
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete location' }
  }
}
