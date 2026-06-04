import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Phase 0 static security guards', () => {
  it('keeps Pay@ staging files placeholder-only', () => {
    const root = join(process.cwd(), '..')
    const shellScript = readFileSync(join(root, 'Plug A Pro/run-payat-test.sh'), 'utf8')
    const deployDoc = readFileSync(join(root, 'Plug A Pro/payat-integration/DEPLOY.md'), 'utf8')

    expect(shellScript).toContain('PAYAT_CLIENT_ID="${PAYAT_CLIENT_ID:?')
    expect(shellScript).toContain('PAYAT_CLIENT_SECRET="${PAYAT_CLIENT_SECRET:?')
    expect(shellScript).toContain('PAYAT_WEBHOOK_SECRET="${PAYAT_WEBHOOK_SECRET:?')
    expect(deployDoc).toContain('PAYAT_CLIENT_SECRET=<set in Vercel>')
    expect(deployDoc).toContain('PAYAT_WEBHOOK_SECRET=<set in Vercel>')
  })

  it('does not include the legacy seed quote approval token', () => {
    const seed = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8')

    expect(seed).not.toContain('seed-quote-token-001')
    expect(seed).toContain('randomBytes')
  })

  it('does not tell production release gates to run pnpm db:seed', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/create-deployment-gates.ts'), 'utf8')

    expect(source).not.toContain('pnpm db:seed')
    expect(source).toContain('Do not run broad database seed scripts in production')
  })
})
