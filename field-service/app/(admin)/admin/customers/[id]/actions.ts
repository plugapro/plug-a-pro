'use server'

export {
  blockCustomerFromFormAction,
  addCustomerNoteFromFormAction,
  archiveCustomerFromFormAction,
  clearCustomerSuspensionFromFormAction,
  deactivateCustomerFromFormAction,
  mergeCustomerFromFormAction,
  purgeCustomerFromFormAction,
  suspendCustomerFromFormAction,
  updateCustomerFromFormAction,
} from '../actions'

export async function unblockCustomerFromFormAction(formData: FormData) {
  const { unblockCustomerAction } = await import('../actions')
  const { CrudActionError } = await import('@/lib/crud-action')
  try {
    const customerId = formData.get('customerId')
    if (typeof customerId !== 'string' || !customerId) {
      return { ok: false as const, error: 'Invalid customer ID' }
    }
    return await unblockCustomerAction(customerId)
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to unblock customer' }
  }
}

export async function toggleWhatsappMarketingFromFormAction(formData: FormData) {
  try {
    const { requireAdmin } = await import('@/lib/auth')
    const admin = await requireAdmin()
    const customerId = formData.get('customerId')
    if (typeof customerId !== 'string' || !customerId) {
      return { ok: false as const, error: 'Invalid customer ID' }
    }
    const value = formData.get('value') === 'true'
    const { db } = await import('@/lib/db')
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { phone: true } })
    if (!customer) return { ok: false as const, error: 'Customer not found' }
    const { applyOptIn, applyOptOut } = await import('@/lib/whatsapp-policy')
    if (value) {
      await applyOptIn(customer.phone, 'admin', { actorId: admin.id, note: 'Admin override from customer detail' })
    } else {
      await applyOptOut(customer.phone, 'admin', { actorId: admin.id, note: 'Admin override from customer detail' })
    }
    const { revalidatePath } = await import('next/cache')
    revalidatePath(`/admin/customers/${customerId}`)
    return { ok: true as const, message: 'WhatsApp preference updated' }
  } catch (err) {
    console.error('[customer/toggle-wa]', err)
    return { ok: false as const, error: 'Failed to update WhatsApp preference' }
  }
}
