'use server'

export {
  addProviderStrikeFromFormAction,
  deleteCertificationFromFormAction,
  deleteEquipmentFromFormAction,
  setProviderStatusFromFormAction,
  addProviderNoteFromFormAction,
  reactivateProviderFromFormAction,
  setProviderKycFromFormAction,
  updateProviderProfileFromFormAction,
  upsertCertificationFromFormAction,
  upsertEquipmentFromFormAction,
  verifyCertificationFromFormAction,
} from '../../providers/actions'

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
