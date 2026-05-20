'use server'

// Next.js 16 + Turbopack rejects `export { ... } from '../module'` inside a
// 'use server' file - only async functions can be exported. Each delegate
// below wraps the canonical action in `providers/actions.ts` (technicians
// share the providers action surface via the route alias).

import {
  addProviderStrikeFromFormAction as _addProviderStrikeFromFormAction,
  deleteCertificationFromFormAction as _deleteCertificationFromFormAction,
  deleteEquipmentFromFormAction as _deleteEquipmentFromFormAction,
  setProviderStatusFromFormAction as _setProviderStatusFromFormAction,
  addProviderNoteFromFormAction as _addProviderNoteFromFormAction,
  reactivateProviderFromFormAction as _reactivateProviderFromFormAction,
  setProviderKycFromFormAction as _setProviderKycFromFormAction,
  updateProviderProfileFromFormAction as _updateProviderProfileFromFormAction,
  upsertCertificationFromFormAction as _upsertCertificationFromFormAction,
  upsertEquipmentFromFormAction as _upsertEquipmentFromFormAction,
  verifyCertificationFromFormAction as _verifyCertificationFromFormAction,
} from '../../providers/actions'

export async function addProviderStrikeFromFormAction(formData: FormData) {
  return _addProviderStrikeFromFormAction(formData)
}
export async function deleteCertificationFromFormAction(formData: FormData) {
  return _deleteCertificationFromFormAction(formData)
}
export async function deleteEquipmentFromFormAction(formData: FormData) {
  return _deleteEquipmentFromFormAction(formData)
}
export async function setProviderStatusFromFormAction(formData: FormData) {
  return _setProviderStatusFromFormAction(formData)
}
export async function addProviderNoteFromFormAction(formData: FormData) {
  return _addProviderNoteFromFormAction(formData)
}
export async function reactivateProviderFromFormAction(formData: FormData) {
  return _reactivateProviderFromFormAction(formData)
}
export async function setProviderKycFromFormAction(formData: FormData) {
  return _setProviderKycFromFormAction(formData)
}
export async function updateProviderProfileFromFormAction(formData: FormData) {
  return _updateProviderProfileFromFormAction(formData)
}
export async function upsertCertificationFromFormAction(formData: FormData) {
  return _upsertCertificationFromFormAction(formData)
}
export async function upsertEquipmentFromFormAction(formData: FormData) {
  return _upsertEquipmentFromFormAction(formData)
}
export async function verifyCertificationFromFormAction(formData: FormData) {
  return _verifyCertificationFromFormAction(formData)
}

export async function verifyProviderFromFormAction(formData: FormData) {
  try {
    const { verifyProviderAction } = await import('../../providers/actions')
    const providerId = formData.get('providerId')
    if (typeof providerId !== 'string' || !providerId) {
      return { ok: false as const, error: 'Invalid provider ID' }
    }
    return await verifyProviderAction(providerId)
  } catch (err) {
    const { CrudActionError } = await import('@/lib/crud-action')
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to verify provider' }
  }
}

export async function toggleActiveFromFormAction(formData: FormData) {
  try {
    const { crudAction } = await import('@/lib/crud-action')
    const { db } = await import('@/lib/db')
    const providerId = formData.get('providerId')
    if (typeof providerId !== 'string' || !providerId) {
      return { ok: false as const, error: 'Invalid provider ID' }
    }
    const provider = await db.provider.findUnique({ where: { id: providerId }, select: { active: true } })
    if (!provider) return { ok: false as const, error: 'Provider not found' }
    // crudAction always returns { ok: true, data } on success and throws a
    // CrudActionError on any failure (auth, role, flag, validation, DB). It
    // never silently returns { ok: false }, so no return-value check is needed
    // here - the catch block below handles all error paths.
    await crudAction({
      entity: 'Provider',
      entityId: providerId,
      action: 'provider.active_toggle',
      requiredRole: ['ADMIN', 'OWNER'],
      requiredFlag: 'admin.crud.providers',
      input: { providerId, currentActive: provider.active },
      before: { active: provider.active },
      run: async (_input, tx) => {
        await tx.provider.update({ where: { id: providerId }, data: { active: !provider.active } })
        return { id: providerId, active: !provider.active }
      },
    })
    const { revalidatePath } = await import('next/cache')
    revalidatePath(`/admin/providers/${providerId}`)
    revalidatePath(`/admin/technicians/${providerId}`)
    return { ok: true as const, message: provider.active ? 'Provider deactivated' : 'Provider activated' }
  } catch (err) {
    const { CrudActionError } = await import('@/lib/crud-action')
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to toggle active status' }
  }
}
