'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import {
  createLocationNode,
  updateLocationNode,
  deactivateLocationNode,
  deleteLocationNode,
  LocationNodeInUseError,
} from '@/lib/location-nodes'

const FLAG = 'admin.crud.locations'
const ROLES = ['OPS', 'ADMIN', 'OWNER'] as const

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateLocationNodeSchema = z.object({
  nodeType: z.enum(['PROVINCE', 'CITY', 'REGION', 'SUBURB']),
  slug: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  parentId: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  radiusKm: z.number().nullable().optional(),
})

const UpdateLocationNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200).optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  radiusKm: z.number().nullable().optional(),
})

type CreateInput = z.infer<typeof CreateLocationNodeSchema>
type UpdateInput = z.infer<typeof UpdateLocationNodeSchema>

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createLocationNodeAction(input: CreateInput) {
  const result = await crudAction<CreateInput, { id: string }>({
    entity: 'LocationNode',
    action: 'location.create',
    requiredRole: [...ROLES],
    requiredFlag: FLAG,
    schema: CreateLocationNodeSchema,
    input,
    run: async (data) => {
      const node = await createLocationNode({
        nodeType: data.nodeType,
        slug: data.slug,
        label: data.label,
        parentId: data.parentId ?? null,
        lat: data.lat ?? undefined,
        lng: data.lng ?? undefined,
        radiusKm: data.radiusKm ?? undefined,
      })
      return { id: node.id }
    },
  })
  revalidatePath('/admin/locations')
  return result
}

export async function updateLocationNodeAction(input: UpdateInput) {
  const result = await crudAction<UpdateInput, { id: string }>({
    entity: 'LocationNode',
    entityId: input.id,
    action: 'location.update',
    requiredRole: [...ROLES],
    requiredFlag: FLAG,
    schema: UpdateLocationNodeSchema,
    input,
    run: async (data) => {
      await updateLocationNode(data.id, {
        label: data.label,
        lat: data.lat,
        lng: data.lng,
        radiusKm: data.radiusKm,
      })
      return { id: data.id }
    },
  })
  revalidatePath('/admin/locations')
  return result
}

export async function deactivateLocationNodeAction(id: string) {
  const result = await crudAction<{ id: string }, { id: string }>({
    entity: 'LocationNode',
    entityId: id,
    action: 'location.deactivate',
    requiredRole: [...ROLES],
    requiredFlag: FLAG,
    input: { id },
    run: async () => {
      await deactivateLocationNode(id)
      return { id }
    },
  })
  revalidatePath('/admin/locations')
  return result
}

export async function deleteLocationNodeAction(id: string) {
  try {
    const result = await crudAction<{ id: string }, { id: string; softDeleted?: boolean }>({
      entity: 'LocationNode',
      entityId: id,
      action: 'location.delete',
      requiredRole: ['ADMIN', 'OWNER'],
      requiredFlag: FLAG,
      input: { id },
      run: async () => {
        await deleteLocationNode(id)
        return { id }
      },
    })
    revalidatePath('/admin/locations')
    return result
  } catch (err) {
    if (err instanceof CrudActionError) throw err
    if (err instanceof LocationNodeInUseError) {
      // Node is referenced - soft-delete instead
      const result = await crudAction<{ id: string }, { id: string; softDeleted: boolean }>({
        entity: 'LocationNode',
        entityId: id,
        action: 'location.deactivate',
        requiredRole: ['ADMIN', 'OWNER'],
        requiredFlag: FLAG,
        input: { id },
        run: async () => {
          await deactivateLocationNode(id)
          return { id, softDeleted: true }
        },
      })
      revalidatePath('/admin/locations')
      return result
    }
    throw err
  }
}

// ─── FormData-compatible wrappers ─────────────────────────────────────────────

export async function createLocationNodeFromFormAction(formData: FormData) {
  const latRaw = formData.get('lat') as string | null
  const lngRaw = formData.get('lng') as string | null
  const radiusRaw = formData.get('radiusKm') as string | null

  try {
    return await createLocationNodeAction({
      nodeType: formData.get('nodeType') as 'PROVINCE' | 'CITY' | 'REGION' | 'SUBURB',
      slug: (formData.get('slug') as string ?? '').trim(),
      label: (formData.get('label') as string ?? '').trim(),
      parentId: (formData.get('parentId') as string | null) || null,
      lat: latRaw ? parseFloat(latRaw) : undefined,
      lng: lngRaw ? parseFloat(lngRaw) : undefined,
      radiusKm: radiusRaw ? parseFloat(radiusRaw) : undefined,
    })
  } catch (err) {
    if (err instanceof CrudActionError) {
      return { ok: false as const, error: err.message }
    }
    return { ok: false as const, error: 'Failed to create location' }
  }
}

export async function updateLabelFromFormAction(formData: FormData) {
  const id = formData.get('id') as string
  const label = (formData.get('label') as string ?? '').trim()
  if (!id || !label) return { ok: false as const, error: 'id and label required' }
  try {
    return await updateLocationNodeAction({ id, label })
  } catch (err) {
    if (err instanceof CrudActionError) {
      return { ok: false as const, error: err.message }
    }
    return { ok: false as const, error: 'Failed to update label' }
  }
}
