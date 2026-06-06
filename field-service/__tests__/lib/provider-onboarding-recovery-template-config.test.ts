import { describe, expect, it } from 'vitest'
import {
  buildRecoveryTemplateComponents,
  recoveryTemplateNameForMessageKey,
} from '@/lib/provider-onboarding-recovery-template-config'
import type { ProviderOnboardingRecoveryTemplateKey } from '@/lib/provider-onboarding-recovery'

describe('provider onboarding recovery template config', () => {
  it.each([
    ['evidence_upload', 'provider_recovery_evidence'],
    ['started_blocked', 'provider_recovery_started_blocked'],
    ['id_verification_stuck', 'provider_recovery_started_blocked'],
    ['skills_picker_stuck', 'provider_recovery_started_blocked'],
    ['location_picker_stuck', 'provider_recovery_started_blocked'],
    ['register_started_no_name', 'provider_recovery_no_name'],
    ['welcome_idle', 'provider_recovery_welcome_idle'],
    ['flow_conflict', 'provider_recovery_flow_conflict'],
    ['submitted_pending', null],
    ['submitted_approved', null],
  ] satisfies Array<[ProviderOnboardingRecoveryTemplateKey, string | null]>)(
    'maps %s to %s',
    (messageKey, templateName) => {
      expect(recoveryTemplateNameForMessageKey(messageKey)).toBe(templateName)
    },
  )

  it('builds a single body component using a safe first-name token', () => {
    expect(buildRecoveryTemplateComponents({ providerName: 'Naledi Maseko' })).toEqual([
      {
        type: 'body',
        parameters: [{ type: 'text', text: 'Naledi' }],
      },
    ])
  })

  it.each([
    [null],
    [''],
    ['A'],
    ['1234'],
    ['Name-With-Way-Too-Many-Characters-For-Meta-Template-Copy'],
  ])('falls back to there for unsafe or missing provider names: %s', (providerName) => {
    expect(buildRecoveryTemplateComponents({ providerName })).toEqual([
      {
        type: 'body',
        parameters: [{ type: 'text', text: 'there' }],
      },
    ])
  })
})
