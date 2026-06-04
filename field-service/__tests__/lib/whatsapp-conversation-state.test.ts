import { describe, it, expect } from 'vitest'
import { clearIncompatibleFlowData } from '@/lib/whatsapp-conversation-state'
import type { FlowName } from '@/lib/whatsapp-flows/types'

describe('clearIncompatibleFlowData', () => {
  it('preserves data when flow does not change', () => {
    const out = clearIncompatibleFlowData('registration', 'registration', {
      name: 'Lebo', skills: ['plumbing'], category: 'plumbing',
    })
    expect(out).toEqual({ name: 'Lebo', skills: ['plumbing'], category: 'plumbing' })
  })

  it('strips customer-flow keys when switching from job_request to registration', () => {
    const out = clearIncompatibleFlowData('job_request', 'registration', {
      category: 'plumbing',
      addressLine1: '12 Long St',
      addressStreet: 'Long St',
      isFirstBooking: true,
      selectedCategory: 'plumbing',
      addrProvinceKey: 'gauteng',
      addrProvinceLabel: 'Gauteng',
      customerName: 'Lebo',
      name: 'Lebo',
    })
    expect(out).toEqual({ name: 'Lebo' })
  })

  it('strips registration-flow keys when switching to job_request', () => {
    const out = clearIncompatibleFlowData('registration', 'job_request', {
      name: 'Lebo',
      skills: ['plumbing'],
      verificationMethod: 'id_number',
      providerIdNumber: '0000000000000',
      category: 'plumbing',
    })
    expect(out).toEqual({ category: 'plumbing' })
  })

  it('returns an empty object when target flow has no whitelist intersection', () => {
    const out = clearIncompatibleFlowData('registration', 'idle' as FlowName, {
      name: 'Lebo', skills: ['plumbing'],
    })
    expect(out).toEqual({})
  })

  it('is a no-op when input is empty', () => {
    expect(clearIncompatibleFlowData('idle', 'registration', {})).toEqual({})
  })
})
