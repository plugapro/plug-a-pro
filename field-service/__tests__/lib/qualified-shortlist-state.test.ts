import { describe, expect, it } from 'vitest'
import {
  canLeadInviteReceiveProviderResponse,
  canProviderAcceptSelectedJob,
  canProviderAppearInShortlist,
  canProviderReceiveLeads,
  canProviderViewFullJobDetails,
  canRequestRunMatching,
  canShowExpiryCountdown,
  mapJobToQualifiedState,
  mapLeadInviteToQualifiedState,
  mapProviderToQualifiedState,
  mapRequestToQualifiedState,
} from '../../lib/qualified-shortlist-state'

describe('qualified shortlist state helpers', () => {
  it('maps provider approval states to lead and shortlist eligibility', () => {
    const approved = {
      active: true,
      verified: true,
      status: 'ACTIVE',
      kycStatus: 'SUBMITTED',
    }
    const trusted = {
      ...approved,
      kycStatus: 'VERIFIED',
      completedJobsCount: 3,
      averageRating: 4.8,
    }
    const suspended = { ...approved, status: 'SUSPENDED' }

    expect(mapProviderToQualifiedState(approved)).toBe('approved')
    expect(mapProviderToQualifiedState(trusted)).toBe('trusted')
    expect(mapProviderToQualifiedState(suspended)).toBe('suspended')
    expect(canProviderReceiveLeads(approved)).toBe(true)
    expect(canProviderAppearInShortlist(approved)).toBe(true)
    expect(canProviderReceiveLeads(suspended)).toBe(false)
  })

  it('maps current request statuses to target request states', () => {
    expect(mapRequestToQualifiedState({ status: 'PENDING_VALIDATION' })).toBe('submitted')
    expect(mapRequestToQualifiedState({ status: 'OPEN' })).toBe('matching')
    expect(mapRequestToQualifiedState({ status: 'MATCHING' })).toBe('awaiting_provider_responses')
    expect(mapRequestToQualifiedState({ status: 'SHORTLIST_READY' })).toBe('shortlist_ready')
    expect(mapRequestToQualifiedState({ status: 'PROVIDER_CONFIRMATION_PENDING' })).toBe('provider_confirmation_pending')
    expect(mapRequestToQualifiedState({ status: 'MATCHED' })).toBe('assigned')
    expect(mapRequestToQualifiedState({ status: 'EXPIRED' })).toBe('expired')
    expect(canRequestRunMatching({ status: 'OPEN' })).toBe(true)
    expect(canRequestRunMatching({ status: 'SHORTLIST_READY' })).toBe(false)
    expect(canRequestRunMatching({ status: 'MATCHED' })).toBe(false)
  })

  it('keeps expiry countdown and provider responses tied to active invite states', () => {
    const future = new Date(Date.now() + 60_000)
    const past = new Date(Date.now() - 60_000)

    expect(mapLeadInviteToQualifiedState({ status: 'SEND_PENDING', expiresAt: null })).toBe('send_pending')
    expect(mapLeadInviteToQualifiedState({ status: 'SEND_FAILED', expiresAt: null })).toBe('send_failed')
    expect(mapLeadInviteToQualifiedState({ status: 'SENT', expiresAt: future })).toBe('sent')
    expect(mapLeadInviteToQualifiedState({ status: 'VIEWED', expiresAt: future })).toBe('viewed')
    expect(mapLeadInviteToQualifiedState({ status: 'SENT', expiresAt: past })).toBe('expired')
    expect(canLeadInviteReceiveProviderResponse({ status: 'SEND_FAILED', expiresAt: null })).toBe(false)
    expect(canLeadInviteReceiveProviderResponse({ status: 'VIEWED', expiresAt: future })).toBe(true)
    expect(canLeadInviteReceiveProviderResponse({ status: 'EXPIRED', expiresAt: past })).toBe(false)
    expect(canShowExpiryCountdown({ status: 'SENT', expiresAt: future })).toBe(true)
    expect(canShowExpiryCountdown({ status: 'ACCEPTED', expiresAt: future })).toBe(false)
  })

  it('requires customer-selected invite, confirmation-pending request, and approved provider for final acceptance', () => {
    const provider = { active: true, verified: true, status: 'ACTIVE', kycStatus: 'VERIFIED' }
    const selectedInvite = {
      status: 'VIEWED',
      customerSelectedAt: new Date('2026-05-02T10:00:00.000Z'),
      expiresAt: new Date(Date.now() + 60_000),
    }
    const confirmationPendingRequest = { status: 'PROVIDER_CONFIRMATION_PENDING' }

    expect(canProviderAcceptSelectedJob(selectedInvite, confirmationPendingRequest, provider)).toBe(true)
    expect(canProviderAcceptSelectedJob({ status: 'VIEWED' }, confirmationPendingRequest, provider)).toBe(false)
    expect(canProviderAcceptSelectedJob(selectedInvite, { status: 'MATCHING' }, provider)).toBe(false)
    expect(canProviderAcceptSelectedJob(selectedInvite, confirmationPendingRequest, { ...provider, status: 'SUSPENDED' })).toBe(false)
  })

  it('maps job execution states and gates full detail access by accepted provider', () => {
    expect(mapJobToQualifiedState({ status: 'SCHEDULED' })).toBe('assigned')
    expect(mapJobToQualifiedState({ status: 'EN_ROUTE' })).toBe('on_the_way')
    expect(mapJobToQualifiedState({ status: 'ARRIVED' })).toBe('arrived')
    expect(mapJobToQualifiedState({ status: 'STARTED' })).toBe('in_progress')
    expect(mapJobToQualifiedState({ status: 'COMPLETED' })).toBe('completed')

    expect(canProviderViewFullJobDetails({ acceptedProviderId: 'provider-1' }, { id: 'provider-1' })).toBe(true)
    expect(canProviderViewFullJobDetails({ acceptedProviderId: 'provider-2' }, { id: 'provider-1' })).toBe(false)
    expect(canProviderViewFullJobDetails({ providerId: 'provider-1', isUnlocked: true }, { id: 'provider-1' })).toBe(true)
  })
})
