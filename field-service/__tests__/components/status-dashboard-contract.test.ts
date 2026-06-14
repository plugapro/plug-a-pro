import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'components/status/StatusDashboard.tsx'),
  'utf8',
)

describe('StatusDashboard monitoring transparency contract', () => {
  it('does not present not_monitored services as operational', () => {
    expect(source).not.toContain("not_monitored: 'Running smoothly'")
    expect(source).not.toContain("status === 'not_monitored' ? 'operational' : status")
    expect(source).toContain("not_monitored: 'Not separately monitored'")
  })

  it('does not truncate the journey card title (mobile labels must wrap, not clip)', () => {
    expect(source).not.toMatch(/font-semibold[^"]*\btruncate\b/)
  })

  it('announces status changes to assistive tech via an aria-live region', () => {
    expect(source).toContain('aria-live')
  })
})
