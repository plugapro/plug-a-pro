import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('technician admin identity redaction', () => {
  it('does not render raw ProviderApplication.idNumber in the technician detail page', () => {
    const source = readFileSync('app/(admin)/admin/technicians/[id]/page.tsx', 'utf8')

    expect(source).not.toContain('{latestApplication.idNumber}')
    expect(source).toContain('identifierLast4')
  })
})
