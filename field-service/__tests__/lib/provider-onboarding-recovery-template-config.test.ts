import { describe, expect, it } from 'vitest'
import {
  buildRecoveryTemplateComponents,
  recoveryTemplateNameForMessageKey,
} from '@/lib/provider-onboarding-recovery-template-config'

describe('provider onboarding recovery template config', () => {
  it.each([
    ['evidence_upload', 'provider_recovery_evidence'],
    ['started_blocked', 'provider_recovery_started_blocked'],
    ['register_started_no_name', 'provider_recovery_no_name'],
    ['welcome_idle', 'provider_recovery_welcome_idle'],
    ['flow_conflict', 'provider_recovery_flow_conflict'],
    ['submitted_no_recovery', null],
  ])('maps %s to %s', (messageKey, templateName) => {
    expect(recoveryTemplateNameForMessageKey(messageKey as never)).toBe(templateName)
  })

  it.each([
    ['Nomsa Dlamini', 'Nomsa'],
    ['   Thabo   Nkosi  ', 'Thabo'],
    [null, 'there'],
    ['', 'there'],
    ['   ', 'there'],
  ])('extracts first-name token from %j', (providerName, expected) => {
    const components = buildRecoveryTemplateComponents({ providerName })
    expect(components).toEqual([{
      type: 'body',
      parameters: [{ type: 'text', text: expected }],
    }])
  })
})
