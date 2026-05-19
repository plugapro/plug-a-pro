import { describe, expect, it } from 'vitest'
import { evaluateHealth } from '../../scripts/smoke-local-health.mjs'

describe('smoke-local-health evaluation', () => {
  const healthyBody = {
    status: 'ok',
    db: 'ok',
    whatsapp: 'ok',
    payments: 'ok',
    auth: { supabase_env_complete: true },
    build: { commitSha: 'abc123' },
  }

  it('accepts a healthy response when required components and commit match', () => {
    expect(
      evaluateHealth(healthyBody, {
        requiredComponents: ['db', 'whatsapp', 'payments', 'auth.supabase_env_complete'],
        expectedCommitSha: 'abc123',
      }),
    ).toEqual({ ok: true, failures: [] })
  })

  it('rejects degraded required components even when top-level status is ok', () => {
    expect(
      evaluateHealth(
        { ...healthyBody, whatsapp: 'error', payments: 'unknown' },
        { requiredComponents: ['db', 'whatsapp', 'payments'] },
      ),
    ).toEqual({
      ok: false,
      failures: ['whatsapp expected ok but received error', 'payments expected ok but received unknown'],
    })
  })

  it('rejects a health response that does not belong to the expected commit', () => {
    expect(
      evaluateHealth(healthyBody, {
        requiredComponents: ['db'],
        expectedCommitSha: 'def456',
      }),
    ).toEqual({
      ok: false,
      failures: ['build.commitSha expected def456 but received abc123'],
    })
  })
})
