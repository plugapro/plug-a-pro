import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '@/lib/messaging-templates'

describe('provider onboarding recovery WhatsApp templates', () => {
  it.each([
    'provider_recovery_evidence',
    'provider_recovery_started_blocked',
    'provider_recovery_no_name',
    'provider_recovery_welcome_idle',
    'provider_recovery_flow_conflict',
  ] as const)('registers %s as an en_ZA utility template with one body parameter', (templateName) => {
    const template = TEMPLATES[templateName]

    expect(template).toMatchObject({
      name: templateName,
      language: 'en_ZA',
      category: 'UTILITY',
    })
    expect(template.example).toContain('{{1}}')
  })
})
