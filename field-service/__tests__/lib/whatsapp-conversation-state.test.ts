import { describe, it, expect } from 'vitest'
import { clearIncompatibleFlowData, resetConversationData } from '@/lib/whatsapp-conversation-state'
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
    // customerName is shared (kept), name is in registration whitelist (kept).
    // Everything else is job_request-only and stripped.
    expect(out).toEqual({ name: 'Lebo', customerName: 'Lebo' })
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

  it('preserves shared keys (flowConflict markers, customerName, prewarningSentAt) across all flow transitions', () => {
    const shared = {
      flowConflictDetectedAt: '2026-06-04T00:00:00Z',
      flowConflictFrom: 'registration' as FlowName,
      flowConflictTo: 'job_request' as FlowName,
      customerName: 'Lebo',
      customerId: 'cust_1',
      prewarningSentAt: '2026-06-04T00:01:00Z',
    }
    const out = clearIncompatibleFlowData('registration', 'job_request', {
      ...shared,
      name: 'Lebo',          // registration-only, gets stripped
      category: 'plumbing',  // job_request-only, kept
    })
    expect(out).toMatchObject(shared)
    expect(out).toMatchObject({ category: 'plumbing' })
    expect((out as Record<string, unknown>).name).toBeUndefined()
  })

  it('keeps only shared keys when transitioning to a flow with no flow-specific overlap', () => {
    const out = clearIncompatibleFlowData('registration', 'idle' as FlowName, {
      name: 'Lebo', skills: ['plumbing'],
      customerName: 'Lebo',
      flowConflictDetectedAt: '2026-06-04T00:00:00Z',
    })
    // name + skills are registration-only; customerName + flowConflictDetectedAt are shared.
    expect(out).toEqual({ customerName: 'Lebo', flowConflictDetectedAt: '2026-06-04T00:00:00Z' })
  })

  it('is a no-op when input is empty', () => {
    expect(clearIncompatibleFlowData('idle', 'registration', {})).toEqual({})
  })
})

describe('resetConversationData', () => {
  const ctwaReferral = {
    sourceType: 'ad',
    sourceId: '120245406174700243',
    ctwaClid: 'clid-1',
    headline: 'Plug A Pro',
    capturedAt: '2026-06-04T08:00:00.000Z',
  }

  it('keeps ctwaReferral through a session reset and drops transient flow state', () => {
    const out = resetConversationData({
      ctwaReferral,
      name: 'Lebo',
      skills: ['plumbing'],
      selectedCategory: 'plumbing',
      customerName: 'Lebo',
    })
    expect(out).toEqual({ ctwaReferral })
  })

  it('returns an empty object when there is nothing to preserve', () => {
    expect(resetConversationData({ name: 'Lebo', skills: ['plumbing'] })).toEqual({})
    expect(resetConversationData({})).toEqual({})
    expect(resetConversationData(null)).toEqual({})
    expect(resetConversationData(undefined)).toEqual({})
  })
})
