import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const applicationStatusEnum = schema.match(/enum ApplicationStatus\s*\{[^}]+\}/)?.[0] ?? ''

describe('provider registration draft schema', () => {
  it('uses a separate draft table instead of adding DRAFT to ApplicationStatus', () => {
    expect(schema).toMatch(/model ProviderApplicationDraft/)
    expect(schema).toMatch(/@@map\("provider_application_drafts"\)/)
    expect(schema).toMatch(/model RegistrationResumeToken/)
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/)
    expect(applicationStatusEnum).not.toContain('DRAFT')
  })

  it('keeps draft call-out fee aligned with the submitted application decimal field', () => {
    expect(schema).toMatch(/model ProviderApplicationDraft\s+\{[\s\S]*callOutFee\s+Decimal\?\s+@db\.Decimal\(10,\s*2\)/)
    expect(schema).toMatch(/model ProviderApplication\s+\{[\s\S]*callOutFee\s+Decimal\?\s+@db\.Decimal\(10,\s*2\)/)
  })
})
