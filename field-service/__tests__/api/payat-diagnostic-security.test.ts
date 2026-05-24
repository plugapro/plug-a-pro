import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Pay@ diagnostic endpoint security', () => {
  it('does not accept diagnostic secrets in query params', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/debug/payat-ping/route.ts'), 'utf8')

    expect(source).not.toContain("searchParams.get('key')")
    expect(source).toContain("headers.get('x-payat-diag-key')")
  })
})
