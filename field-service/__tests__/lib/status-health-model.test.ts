import { describe, expect, it } from 'vitest'
import {
  healthForUnavailableEndpoint,
  normalizeHealthResponse,
} from '@/lib/status/health-model'

describe('status health normalization', () => {
  it('maps a healthy payload to operational checks', () => {
    const response = {
      status: 'ok',
      db: 'ok',
      timestamp: '2026-05-05T08:00:00.000Z',
      build: {
        commitSha: '123456789abcdef',
        commitShaShort: '1234567',
        commitRef: 'main',
        builtAt: '2026-05-05T07:00:00.000Z',
      },
    }

    const model = normalizeHealthResponse(response)

    expect(model.overallStatus).toBe('operational')
    const core = model.serviceGroups.find((group) => group.id === 'core-platform')
    expect(core?.status).toBe('operational')
    expect(core?.checks.find((check) => check.id === 'core-db')?.status).toBe('operational')
    expect(core?.checks.find((check) => check.id === 'core-web-app')?.source).toBe('live check')
    expect(model.build.commitShaShort).toBe('1234567')
    expect(model.build.commitRef).toBe('main')
  })

  it('maps DB error to core platform down and degraded/overall impact', () => {
    const response = {
      status: 'ok',
      db: 'error',
    }

    const model = normalizeHealthResponse(response)
    const core = model.serviceGroups.find((group) => group.id === 'core-platform')
    const dbCheck = core?.checks.find((check) => check.id === 'core-db')

    expect(core?.status).toBe('down')
    expect(dbCheck?.status).toBe('down')
    expect(model.overallStatus).toBe('down')
  })

  it('handles malformed payloads without throwing and marks unknown state', () => {
    const model = normalizeHealthResponse('bad payload')

    expect(model.overallStatus).toBe('unknown')
    expect(model.serviceGroups.find((group) => group.id === 'core-platform')?.status).toBe('unknown')
    expect(model.serviceGroups[0]?.checks[0]?.status).toBe('unknown')
    expect(model.robotMessage).toBe('Core platform status is partially unknown. Please check back shortly.')
  })

  it('creates a safe fallback model when health is unavailable', () => {
    const model = healthForUnavailableEndpoint('timeout', '2026-05-05T08:00:00.000Z')
    const core = model.serviceGroups.find((group) => group.id === 'core-platform')
    const auth = model.serviceGroups.find((group) => group.id === 'auth')

    expect(model.overallStatus).toBe('unknown')
    expect(core?.checks[0]?.source).toBe('not_monitored')
    expect(core?.status).toBe('unknown')
    expect(auth?.checks[0]?.status).toBe('not_monitored')
    expect(auth?.status).toBe('not_monitored')
    expect(model.robotMessage).toContain('cannot reach the health endpoint')
  })
})
