import { describe, expect, it } from 'vitest'
import {
  buildFallbackHealthModel,
  normalizeHealthPayload,
  statusSourceLabel,
  summarizeGroup,
  summarizeGroups,
} from '@/lib/status/health'

describe('status health model', () => {
  it('maps a healthy response to operational core status', () => {
    const model = normalizeHealthPayload({
      status: 'ok',
      db: 'ok',
      timestamp: '2026-01-01T10:00:00.000Z',
      build: {
        commitSha: 'abcdef123456',
        commitShaShort: 'abcdef1',
        commitRef: 'main',
        builtAt: '2026-01-01T09:00:00.000Z',
      },
    })

    expect(model.overall).toBe('operational')
    expect(model.healthEndpoint).toBe('operational')
    expect(model.database).toBe('operational')
    expect(model.build.commitShaShort).toBe('abcdef1')
    expect(model.build.commitRef).toBe('main')
    expect(model.groups.some((group) => group.id === 'core-platform')).toBe(true)
  })

  it('handles missing build metadata without crashing', () => {
    const model = normalizeHealthPayload({
      status: 'ok',
      db: 'ok',
      timestamp: '2026-01-01T10:00:00.000Z',
    })

    expect(model.build.commitShaShort).toBeNull()
    expect(model.build.commitRef).toBeNull()
    expect(model.build.builtAt).toBeNull()
    expect(model.groups.find((group) => group.id === 'core-platform')?.services[3].status).toBe('not_monitored')
  })

  it('maps DB errors into degraded or down core health', () => {
    const model = normalizeHealthPayload({
      status: 'degraded',
      db: 'error',
      timestamp: '2026-01-01T10:00:00.000Z',
      build: {
        commitRef: 'main',
      },
    })

    expect(model.healthEndpoint).toBe('degraded')
    expect(model.database).toBe('down')
    expect(model.overall).toBe('down')
  })

  it('marks non-monitored services as not separately monitored', () => {
    const model = normalizeHealthPayload({
      status: 'ok',
      db: 'ok',
      timestamp: '2026-01-01T10:00:00.000Z',
    })
    const providerServices = model.groups.find((group) => group.id === 'provider-journey')?.services ?? []
    expect(providerServices.length).toBeGreaterThan(0)
    expect(providerServices.every((service) => service.source === 'not monitored')).toBe(true)
  })

  it('builds a safe fallback when health endpoint cannot be reached', () => {
    const fallback = buildFallbackHealthModel('network error')

    expect(fallback.overall).toBe('unknown')
    expect(fallback.healthEndpoint).toBe('unknown')
    expect(fallback.botMessage).toContain('cannot reach')
    expect(statusSourceLabel['not monitored']).toContain('not separately monitored')
  })

  it('summarizes service group status for overviews', () => {
    const groupSummary = summarizeGroup([
      { status: 'operational', source: 'live check', summary: 'Running', impact: '', details: '', id: '1', name: 'a' },
      { status: 'down', source: 'derived', summary: 'Not running', impact: '', details: '', id: '2', name: 'b' },
      { status: 'not_monitored', source: 'not monitored', summary: 'Not separately monitored', impact: '', details: '', id: '3', name: 'c' },
    ])
    expect(groupSummary.overall).toBe('down')
    expect(groupSummary.down).toBe(1)
    expect(groupSummary.operational).toBe(1)
    expect(groupSummary.notMonitored).toBe(1)
  })

  it('exposes group-level group summary helper without mutation', () => {
    const providerGroup = normalizeHealthPayload({
      status: 'ok',
      db: 'ok',
      timestamp: '2026-01-01T10:00:00.000Z',
    }).groups.find((group) => group.id === 'client-journey')

    expect(providerGroup).toBeDefined()
    const result = summarizeGroups([
      providerGroup!,
      {
        id: 'merchant-journey',
        name: 'Merchant / Commercial Journey',
        services: [],
      },
    ])
    expect(result).toHaveLength(2)
  })
})
