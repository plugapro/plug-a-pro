import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('provider applications admin layout', () => {
  it('keeps approved providers collapsed until an admin expands the row', () => {
    const source = readFileSync(join(process.cwd(), 'app/(admin)/admin/applications/page.tsx'), 'utf8')

    expect(source).toContain('data-admin-application-row="approved-provider"')
    expect(source).toContain('data-admin-application-details="approved-provider"')
    expect(source).toContain('<summary')
    expect(source).toContain('View categories')
    expect(source).toContain('Category-level approval')
    expect(source).not.toContain('<details open')
  })

  it('surfaces WhatsApp onboarding recovery stages for manual follow-up', () => {
    const source = readFileSync(join(process.cwd(), 'app/(admin)/admin/applications/page.tsx'), 'utf8')

    expect(source).toContain('listProviderOnboardingRecoveryRows')
    expect(source).toContain('WhatsApp onboarding recovery')
    expect(source).toContain('data-admin-onboarding-recovery-row')
    expect(source).toContain('phoneMasked')
    expect(source).toContain('followUpMessage')
    expect(source).toContain('recommendedAction')
    expect(source).not.toContain('row.phone}</TableCell>')
    expect(source).toContain('flow_conflict')
  })
})
