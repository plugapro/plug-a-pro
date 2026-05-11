import { describe, expect, it } from 'vitest'
import {
  mapLeadStatusToBlueprintState,
  mapRequestStatusToBlueprintState,
  REQUEST_STATUS_VOCABULARY_MATRIX,
} from '@/lib/journey-status-vocabulary'

describe('journey status vocabulary mapping', () => {
  it('maps quick-match request states into canonical blueprint states', () => {
    expect(mapRequestStatusToBlueprintState({
      status: 'PENDING_VALIDATION',
      assignmentMode: 'AUTO_ASSIGN',
    })).toBe('awaiting_matching_mode')

    expect(mapRequestStatusToBlueprintState({
      status: 'OPEN',
      assignmentMode: 'AUTO_ASSIGN',
    })).toBe('quick_match_active')

    expect(mapRequestStatusToBlueprintState({
      status: 'MATCHING',
      assignmentMode: 'AUTO_ASSIGN',
    })).toBe('quick_match_rotating')
  })

  it('maps review-first request states into canonical blueprint states', () => {
    expect(mapRequestStatusToBlueprintState({
      status: 'PENDING_VALIDATION',
      assignmentMode: 'OPS_REVIEW',
    })).toBe('awaiting_matching_mode')

    expect(mapRequestStatusToBlueprintState({
      status: 'PENDING_VALIDATION',
      assignmentMode: 'OPS_REVIEW',
      hasProviderOptions: true,
    })).toBe('provider_options_ready')

    expect(mapRequestStatusToBlueprintState({
      status: 'OPEN',
      assignmentMode: 'OPS_REVIEW',
    })).toBe('review_matching_started')

    expect(mapRequestStatusToBlueprintState({
      status: 'MATCHING',
      assignmentMode: 'OPS_REVIEW',
      hasInterestedProviders: true,
    })).toBe('provider_responses_received')
  })

  it('maps lead lifecycle statuses to provider-facing blueprint states', () => {
    expect(mapLeadStatusToBlueprintState('SENT')).toBe('invited')
    expect(mapLeadStatusToBlueprintState('INTERESTED')).toBe('responded_available')
    expect(mapLeadStatusToBlueprintState('CUSTOMER_SELECTED')).toBe('customer_selected')
    expect(mapLeadStatusToBlueprintState('PROVIDER_ACCEPTED')).toBe('accepted')
    expect(mapLeadStatusToBlueprintState('CREDIT_REQUIRED')).toBe('credit_required')
    expect(mapLeadStatusToBlueprintState('ACCEPTED_LOCKED')).toBe('accepted')
    expect(mapLeadStatusToBlueprintState('ACCEPTED')).toBe('accepted')
    expect(mapLeadStatusToBlueprintState('EXPIRED')).toBe('expired')
  })

  it('maintains full persisted request-status coverage in the vocabulary matrix', () => {
    // The matrix must be explicit for every persisted request status so no UI
    // or release-gate reporting path can silently fall through.
    expect(Object.keys(REQUEST_STATUS_VOCABULARY_MATRIX).sort()).toEqual([
      'ACCEPTED_LOCKED',
      'CANCELLED',
      'EXPIRED',
      'MATCHED',
      'MATCHING',
      'OPEN',
      'PENDING_VALIDATION',
      'PROVIDER_CONFIRMATION_PENDING',
      'SHORTLIST_READY',
    ])
  })
})
