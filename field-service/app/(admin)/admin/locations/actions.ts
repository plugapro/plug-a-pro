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

// FormData-compatible wrappers for HTML <form> submissions ────────────────────

export async function createLocationNodeFromFormAction(formData: FormData) {
  await requireAdmin()
  const nodeType = formData.get('nodeType') as 'PROVINCE' | 'CITY' | 'REGION' | 'SUBURB'
  const slug = (formData.get('slug') as string ?? '').trim()
  const label = (formData.get('label') as string ?? '').trim()
  const parentId = (formData.get('parentId') as string | null) || null
  const latRaw = formData.get('lat') as string | null
  const lngRaw = formData.get('lng') as string | null
  const radiusRaw = formData.get('radiusKm') as string | null

  if (!nodeType || !slug || !label) {
    return { ok: false, error: 'nodeType, slug and label are required' }
  }

  try {
    const node = await createLocationNode({
      nodeType,
      slug,
      label,
      parentId,
      lat: latRaw ? parseFloat(latRaw) : undefined,
      lng: lngRaw ? parseFloat(lngRaw) : undefined,
      radiusKm: radiusRaw ? parseFloat(radiusRaw) : undefined,
    })
    revalidatePath('/admin/locations')
    return { ok: true, id: node.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create location' }
  }
}

export async function updateLabelFromFormAction(formData: FormData) {
  await requireAdmin()
  const id = formData.get('id') as string
  const label = (formData.get('label') as string ?? '').trim()
  if (!id || !label) return { ok: false, error: 'id and label required' }
  try {
    await updateLocationNode(id, { label })
    revalidatePath('/admin/locations')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update label' }
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
