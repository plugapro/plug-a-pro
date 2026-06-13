import { describe, expect, it } from 'vitest'
import {
  buildFallbackHealthModel,
  getActiveIssues,
  normalizeHealthPayload,
  STATUS_LABELS,
  type HealthStatus,
  statusSourceLabel,
  summarizeGroup,
  summarizeGroups,
} from '@/lib/status/health'

describe('status health model', () => {
  it('maps a healthy response to operational core status', () => {
    const model = normalizeHealthPayload({
      status: 'ok',
      db: 'ok',
      timestamp: new Date().toISOString(),
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
      timestamp: new Date().toISOString(),
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
    const issues = getActiveIssues([
      {
        id: 'test-group',
        name: 'Test Group',
        services: [
          { id: 'a', name: 'A', status: 'operational', source: 'live check', summary: 'Running', impact: 'ok', details: '' },
          { id: 'b', name: 'B', status: 'operational', source: 'derived', summary: 'Running', impact: 'ok', details: '' },
        ],
      },
    ])
    expect(issues).toHaveLength(0)
  })

  it('returns operational model with non-critical journey signals when not_monitored is suppressed by call site', () => {
    const model = normalizeHealthPayload({ status: 'ok', db: 'ok', timestamp: '2026-01-01T10:00:00.000Z' })
    const issues = getActiveIssues(model.groups)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((s) => s.status === 'degraded' || s.status === 'down' || s.status === 'not_monitored')).toBe(true)
    expect(issues.some((s) => s.status === 'not_monitored')).toBe(true)
  })

  it('returns no active issues when calling with an all-healthy explicit snapshot', () => {
    const model = normalizeHealthPayload({
      status: 'ok',
      db: 'ok',
      whatsapp: 'ok',
      payments: 'ok',
      timestamp: '2026-01-01T10:00:00.000Z',
    })
    const alwaysOperational = model.groups.map((group) => ({
      ...group,
      services: group.services.map((service) => ({
        ...service,
        status: 'operational' as HealthStatus,
        source: service.source,
        summary: STATUS_LABELS.operational,
      })),
    }))
    const healthyIssues = getActiveIssues(alwaysOperational)
    expect(healthyIssues).toHaveLength(0)
  })

  it('returns active issues when core services are degraded or down', () => {
    const model = normalizeHealthPayload({
      status: 'degraded',
      db: 'error',
      timestamp: '2026-01-01T10:00:00.000Z',
    })
    const issues = getActiveIssues(model.groups)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((s) => s.status === 'down' || s.status === 'degraded' || s.status === 'not_monitored')).toBe(true)
  })

  it('getActiveIssues includes not_monitored services when present', () => {
    const model = normalizeHealthPayload({ status: 'ok', db: 'ok', timestamp: '2026-01-01T10:00:00.000Z' })
    const issues = getActiveIssues(model.groups)
    expect(issues.some((s) => s.status === 'not_monitored')).toBe(true)
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

  it('marks the model stale and overall unknown when the timestamp exceeds max age', () => {
    const oldIso = new Date(Date.now() - 5 * 60_000).toISOString()
    const model = normalizeHealthPayload({ status: 'ok', db: 'ok', timestamp: oldIso })
    expect(model.stale).toBe(true)
    expect(model.overall).toBe('unknown')
  })

  it('is not stale for a fresh timestamp', () => {
    const model = normalizeHealthPayload({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() })
    expect(model.stale).toBe(false)
    expect(model.overall).toBe('operational')
  })

  it('maps a maintenance payload to overall maintenance', () => {
    const model = normalizeHealthPayload({ status: 'maintenance', db: 'ok', timestamp: new Date().toISOString() })
    expect(model.overall).toBe('maintenance')
  })

  it('does not claim WhatsApp/payments are verified when they are not monitored', () => {
    const model = normalizeHealthPayload({
      status: 'ok', db: 'ok', whatsapp: 'unknown', payments: 'unknown',
      timestamp: new Date().toISOString(),
    })
    expect(model.overall).toBe('operational')
    expect(model.botMessage).not.toBe('All core services are running.')
    expect(model.botMessage.toLowerCase()).toContain('not')
  })
})
