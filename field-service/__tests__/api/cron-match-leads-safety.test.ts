import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('match-leads cron safety', () => {
  it('does not contain the old provider auto-approval credit-award path', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/cron/match-leads/route.ts'), 'utf8')

    expect(source).not.toContain('PROVIDER_AUTO_APPROVAL_WINDOW_MINUTES')
    expect(source).not.toContain('autoApproved')
    expect(source).not.toContain('awardMobileVerifiedPromoCreditsInTransaction')
    expect(source).toContain('routeProviderApplicationsForOpsReview')
  })

  it('dispatches only explicit quick-match requests from cron', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/cron/match-leads/route.ts'), 'utf8')

    expect(source).toContain("where: { status: 'OPEN', assignmentMode: 'AUTO_ASSIGN' }")
  })
})
