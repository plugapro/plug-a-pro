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
})
