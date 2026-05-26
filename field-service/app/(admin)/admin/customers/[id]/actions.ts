'use server'

// Next.js 16 + Turbopack rejects `export { ... } from '../module'` inside a
// 'use server' file - only async functions can be exported. Each delegate
// below wraps the canonical action in `customers/actions.ts` so the detail
// page's CustomerActionsPanel can import everything from one module without
// the parent actions file needing a separate detail-route entry point.

import {
  blockCustomerFromFormAction as _blockCustomerFromFormAction,
  addCustomerNoteFromFormAction as _addCustomerNoteFromFormAction,
  archiveCustomerFromFormAction as _archiveCustomerFromFormAction,
  clearCustomerSuspensionFromFormAction as _clearCustomerSuspensionFromFormAction,
  deactivateCustomerFromFormAction as _deactivateCustomerFromFormAction,
  mergeCustomerFromFormAction as _mergeCustomerFromFormAction,
  purgeCustomerFromFormAction as _purgeCustomerFromFormAction,
  suspendCustomerFromFormAction as _suspendCustomerFromFormAction,
  toggleWhatsappMarketingAction as _toggleWhatsappMarketingAction,
  updateCustomerFromFormAction as _updateCustomerFromFormAction,
} from '../actions'

export async function blockCustomerFromFormAction(formData: FormData) {
  return _blockCustomerFromFormAction(formData)
}
export async function addCustomerNoteFromFormAction(formData: FormData) {
  return _addCustomerNoteFromFormAction(formData)
}
export async function archiveCustomerFromFormAction(formData: FormData) {
  return _archiveCustomerFromFormAction(formData)
}
export async function clearCustomerSuspensionFromFormAction(formData: FormData) {
  return _clearCustomerSuspensionFromFormAction(formData)
}
export async function deactivateCustomerFromFormAction(formData: FormData) {
  return _deactivateCustomerFromFormAction(formData)
}
export async function mergeCustomerFromFormAction(formData: FormData) {
  return _mergeCustomerFromFormAction(formData)
}
export async function purgeCustomerFromFormAction(formData: FormData) {
  return _purgeCustomerFromFormAction(formData)
}
export async function suspendCustomerFromFormAction(formData: FormData) {
  return _suspendCustomerFromFormAction(formData)
}
export async function updateCustomerFromFormAction(formData: FormData) {
  return _updateCustomerFromFormAction(formData)
}

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
  const customerId = formData.get('customerId')
  if (typeof customerId !== 'string' || !customerId) {
    return { ok: false as const, error: 'Invalid customer ID' }
  }
  return _toggleWhatsappMarketingAction({
    customerId,
    value: formData.get('value') === 'true',
  })
}
