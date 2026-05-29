import { describe, it, expect } from 'vitest'
import {
  evaluateProviderProfileCompleteness,
  describeMissingFields,
  type ProviderProfileLike,
} from '@/lib/provider-onboarding-completeness'

const completeProfile: ProviderProfileLike = {
  name: 'Lovemore',
  phone: '+27823035070',
  email: 'lovemore@example.com',
  skills: ['Plumbing'],
  serviceAreas: ['Soweto'],
  experience: '3–5 years',
  availability: 'Mon, Tue, Wed, Thu, Fri',
  callOutFee: 350,
  rateNegotiable: true,
  evidenceFileCount: 0,
  idNumber: '0000000000000',
  avatarUrl: 'https://blob.vercel-storage.com/avatar.jpg',
}

describe('evaluateProviderProfileCompleteness', () => {
  it('returns ok=true when every required and recommended field is present', () => {
    const result = evaluateProviderProfileCompleteness(completeProfile)
    expect(result.ok).toBe(true)
    expect(result.canSubmit).toBe(true)
    expect(result.canApprove).toBe(true)
    expect(result.canShowToCustomers).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('blocks submission when name is missing', () => {
    const result = evaluateProviderProfileCompleteness({ ...completeProfile, name: '' })
    expect(result.canSubmit).toBe(false)
    expect(result.missing.find((m) => m.field === 'name')).toBeDefined()
    expect(result.missing.find((m) => m.field === 'name')?.severity).toBe('block_submit')
  })

  it('blocks submission when skills are missing', () => {
    const result = evaluateProviderProfileCompleteness({ ...completeProfile, skills: [] })
    expect(result.canSubmit).toBe(false)
    expect(result.missing.find((m) => m.field === 'skills')).toBeDefined()
  })

  it('blocks submission when service areas are missing', () => {
    const result = evaluateProviderProfileCompleteness({ ...completeProfile, serviceAreas: [] })
    expect(result.canSubmit).toBe(false)
    expect(result.missing.find((m) => m.field === 'serviceAreas')).toBeDefined()
  })

  it('does not block approval when ID/passport is missing because paid credits are gated separately', () => {
    const result = evaluateProviderProfileCompleteness({ ...completeProfile, idNumber: null })
    expect(result.canSubmit).toBe(true)
    expect(result.canApprove).toBe(true)
    expect(result.missing.find((m) => m.field === 'idNumber')?.severity).toBe('recommended')
  })

  it('blocks customer display (but allows approval) when call-out fee is missing', () => {
    const result = evaluateProviderProfileCompleteness({ ...completeProfile, callOutFee: null })
    expect(result.canSubmit).toBe(true)
    expect(result.canApprove).toBe(true)
    expect(result.canShowToCustomers).toBe(false)
    const callOutEntry = result.missing.find((m) => m.field === 'callOutFee')
    expect(callOutEntry).toBeDefined()
    expect(callOutEntry?.reason).toMatch(/labour rate, excluding materials/)
    expect(callOutEntry?.severity).toBe('block_customer_display')
  })

  it('flags missing experience as a customer-display gap', () => {
    const result = evaluateProviderProfileCompleteness({ ...completeProfile, experience: null })
    expect(result.canShowToCustomers).toBe(false)
    expect(result.missing.find((m) => m.field === 'experience')?.severity).toBe('block_customer_display')
  })

  it('treats avatarUrl as recommended only - does not block customer display', () => {
    const result = evaluateProviderProfileCompleteness({
      ...completeProfile,
      avatarUrl: null,
      profilePhotoAttachmentId: null,
    })
    expect(result.ok).toBe(false) // because something is still missing
    expect(result.canSubmit).toBe(true)
    expect(result.canApprove).toBe(true)
    expect(result.canShowToCustomers).toBe(true)
    const avatarEntry = result.missing.find((m) => m.field === 'avatarUrl')
    expect(avatarEntry?.severity).toBe('recommended')
  })

  it('accepts a profilePhotoAttachmentId in lieu of avatarUrl', () => {
    const result = evaluateProviderProfileCompleteness({
      ...completeProfile,
      avatarUrl: null,
      profilePhotoAttachmentId: 'att_profile_001',
    })
    expect(result.ok).toBe(true)
  })

  // G4: locationNodeIds completeness validation
  it('blocks submission when both serviceAreas and locationNodeIds are absent', () => {
    const result = evaluateProviderProfileCompleteness({
      ...completeProfile,
      serviceAreas: [],
      locationNodeIds: [],
    })
    expect(result.canSubmit).toBe(false)
    const entry = result.missing.find((m) => m.field === 'serviceAreas')
    expect(entry).toBeDefined()
    expect(entry?.severity).toBe('block_submit')
  })

  it('accepts locationNodeIds alone as sufficient for the service-area requirement', () => {
    const result = evaluateProviderProfileCompleteness({
      ...completeProfile,
      serviceAreas: [],
      locationNodeIds: ['loc_abc123', 'loc_def456'],
    })
    // serviceAreas field should not appear in missing list
    expect(result.missing.find((m) => m.field === 'serviceAreas')).toBeUndefined()
    expect(result.canSubmit).toBe(true)
  })

  it('accepts legacy serviceAreas alone when locationNodeIds is absent', () => {
    const result = evaluateProviderProfileCompleteness({
      ...completeProfile,
      serviceAreas: ['Soweto'],
      locationNodeIds: null,
    })
    expect(result.missing.find((m) => m.field === 'serviceAreas')).toBeUndefined()
    expect(result.canSubmit).toBe(true)
  })

  it('accepts when both serviceAreas and locationNodeIds are provided', () => {
    const result = evaluateProviderProfileCompleteness({
      ...completeProfile,
      serviceAreas: ['Soweto'],
      locationNodeIds: ['loc_abc123'],
    })
    expect(result.missing.find((m) => m.field === 'serviceAreas')).toBeUndefined()
    expect(result.canSubmit).toBe(true)
  })
})

describe('describeMissingFields', () => {
  it('returns an empty string when complete', () => {
    expect(describeMissingFields(completeProfile)).toBe('')
  })

  it('returns a bullet list of reasons when fields are missing', () => {
    const text = describeMissingFields({ ...completeProfile, callOutFee: null, avatarUrl: null })
    expect(text).toMatch(/^• callOutFee/)
    expect(text).toMatch(/labour rate, excluding materials/)
  })
})
