import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '@/lib/messaging-templates'

describe('recovery messaging templates', () => {
  const recoveryTemplates = [
    'provider_recovery_evidence',
    'provider_recovery_started_blocked',
    'provider_recovery_no_name',
    'provider_recovery_welcome_idle',
    'provider_recovery_flow_conflict',
  ] as const

  it.each(recoveryTemplates)('has required metadata for %s', (templateKey) => {
    const template = TEMPLATES[templateKey]
    expect(template.language).toBe('en_ZA')
    expect(template.category).toBe('UTILITY')
    expect(template.example).toContain('{{1}}')
  })
})
