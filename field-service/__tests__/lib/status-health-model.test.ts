import { describe, expect, it } from 'vitest'
import {
  buildFallbackHealthModel,
  getActiveIssues,
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

  it('handles a partial payload with missing db field gracefully', () => {
    const model = normalizeHealthPayload({ status: 'ok', timestamp: '2026-01-01T10:00:00.000Z' })
    expect(model.overall).toBe('unknown')
    expect(model.database).toBe('unknown')
    expect(model.healthEndpoint).toBe('operational')
    expect(model.botMessage).toBeTruthy()
  })

  it('produces overall unknown when status field is missing', () => {
    const model = normalizeHealthPayload({ db: 'ok', timestamp: '2026-01-01T10:00:00.000Z' })
    expect(model.overall).toBe('unknown')
    expect(model.healthEndpoint).toBe('unknown')
    expect(model.database).toBe('operational')
  })

  it('returns no active issues for a fully operational model', () => {
    const model = normalizeHealthPayload({ status: 'ok', db: 'ok', timestamp: '2026-01-01T10:00:00.000Z' })
    const issues = getActiveIssues(model.groups)
    expect(issues.every((s) => s.status === 'down' || s.status === 'degraded')).toBe(true)
    const coreGroup = model.groups.find((g) => g.id === 'core-platform')!
    const coreIssues = getActiveIssues([coreGroup])
    expect(coreIssues).toHaveLength(0)
  })

  it('returns active issues when core services are degraded or down', () => {
    const model = normalizeHealthPayload({
      status: 'degraded',
      db: 'error',
      timestamp: '2026-01-01T10:00:00.000Z',
    })
    const issues = getActiveIssues(model.groups)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((s) => s.status === 'down' || s.status === 'degraded')).toBe(true)
  })

  it('issue ribbon source: getActiveIssues excludes not_monitored and unknown services', () => {
    const model = normalizeHealthPayload({ status: 'ok', db: 'ok', timestamp: '2026-01-01T10:00:00.000Z' })
    const issues = getActiveIssues(model.groups)
    expect(issues.some((s) => s.status === 'not_monitored' || s.status === 'unknown')).toBe(false)
  })

  it('falls back gracefully when payload is null', () => {
    const model = normalizeHealthPayload(null)
    expect(model.overall).toBe('unknown')
    expect(model.groups.length).toBeGreaterThan(0)
  })

  it('maps whatsapp:ok probe to operational in notification group', () => {
    const model = normalizeHealthPayload({
      status: 'ok', db: 'ok', whatsapp: 'ok', timestamp: '2026-01-01T10:00:00.000Z',
    })
    const whatsappService = model.groups
      .find((g) => g.id === 'notification-journey')?.services
      .find((s) => s.id === 'whatsapp-cloud')
    expect(whatsappService?.status).toBe('operational')
    expect(whatsappService?.source).toBe('live check')
  })

  it('maps whatsapp:error probe to down in notification group', () => {
    const model = normalizeHealthPayload({
      status: 'ok', db: 'ok', whatsapp: 'error', timestamp: '2026-01-01T10:00:00.000Z',
    })
    const whatsappService = model.groups
      .find((g) => g.id === 'notification-journey')?.services
      .find((s) => s.id === 'whatsapp-cloud')
    expect(whatsappService?.status).toBe('down')
  })

  it('maps whatsapp:unknown probe to not_monitored in notification group', () => {
    const model = normalizeHealthPayload({
      status: 'ok', db: 'ok', whatsapp: 'unknown', timestamp: '2026-01-01T10:00:00.000Z',
    })
    const whatsappService = model.groups
      .find((g) => g.id === 'notification-journey')?.services
      .find((s) => s.id === 'whatsapp-cloud')
    expect(whatsappService?.status).toBe('not_monitored')
  })

  it('maps payments:ok probe to operational in merchant group', () => {
    const model = normalizeHealthPayload({
      status: 'ok', db: 'ok', payments: 'ok', timestamp: '2026-01-01T10:00:00.000Z',
    })
    const paymentService = model.groups
      .find((g) => g.id === 'merchant-journey')?.services
      .find((s) => s.id === 'payment-status')
    expect(paymentService?.status).toBe('operational')
    expect(paymentService?.source).toBe('derived')
  })
})
