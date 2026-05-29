import { describe, expect, it } from 'vitest'
import {
  analyzeFlyerMonitorRows,
  buildFlyerMonitorReport,
  maskPhone,
  normalizePhone,
  type FlyerMonitorRow,
} from '@/lib/flyer-monitor'

describe('flyer monitor phone handling', () => {
  it('normalizes plus, bare 27 and local 0-prefixed SA phones', () => {
    expect(normalizePhone('+27 77 392 3802')).toBe('+27773923802')
    expect(normalizePhone('27773923802')).toBe('+27773923802')
    expect(normalizePhone('0773923802')).toBe('+27773923802')
  })

  it('masks phones without leaking raw 10 digit numbers', () => {
    expect(maskPhone('+27773923802')).toBe('+27****3802')
  })
})

describe('analyzeFlyerMonitorRows', () => {
  it('deduplicates excluded phones and keeps the furthest real prospect stage', () => {
    const rows: FlyerMonitorRow[] = [
      {
        stage: 'otp_sent',
        phone: '+27773923802',
        at: '2026-05-29T08:00:00.000Z',
        detail: 'sent',
        failureCode: null,
      },
      {
        stage: 'otp_sent',
        phone: '+27821230000',
        at: '2026-05-29T08:00:00.000Z',
        detail: 'sent',
        failureCode: null,
      },
      {
        stage: 'auth_user',
        phone: '27821230000',
        at: '2026-05-29T08:02:00.000Z',
        detail: null,
        failureCode: null,
      },
      {
        stage: 'customer',
        phone: '+27821230000',
        at: '2026-05-29T08:03:00.000Z',
        detail: null,
        failureCode: null,
      },
      {
        stage: 'provider_app',
        phone: '+27821230000',
        at: '2026-05-29T07:20:00.000Z',
        detail: 'PENDING / NO_FLAGS',
        failureCode: null,
      },
    ]

    const report = analyzeFlyerMonitorRows({
      now: new Date('2026-05-29T10:00:00.000Z'),
      windowStart: new Date('2026-05-29T04:00:00.000Z'),
      windowEnd: new Date('2026-05-29T10:00:00.000Z'),
      rows,
      securityEvents: [],
      lifetimeCounts: { customers: 10, providers: 4, providerApplications: 7 },
    })

    expect(report.prospectCount).toBe(1)
    expect(report.prospects[0]).toMatchObject({
      phoneMasked: '+27****0000',
      furthestStage: 'provider_app',
    })
    expect(report.prospects[0]?.friction[0]).toMatchObject({
      code: 'PROVIDER_APP_PENDING',
      humanActionRecommended: true,
    })
  })

  it('flags OTP entry and identity-link stalls from stage timing', () => {
    const report = analyzeFlyerMonitorRows({
      now: new Date('2026-05-29T10:00:00.000Z'),
      windowStart: new Date('2026-05-29T04:00:00.000Z'),
      windowEnd: new Date('2026-05-29T10:00:00.000Z'),
      rows: [
        {
          stage: 'otp_sent',
          phone: '+27821230010',
          at: '2026-05-29T09:30:00.000Z',
          detail: 'sent',
          failureCode: null,
        },
        {
          stage: 'auth_user',
          phone: '+27821230011',
          at: '2026-05-29T09:20:00.000Z',
          detail: null,
          failureCode: null,
        },
      ],
      securityEvents: [],
      lifetimeCounts: { customers: 10, providers: 4, providerApplications: 7 },
    })

    expect(report.frictionSummary.otpEntry).toBe(1)
    expect(report.frictionSummary.identityLink).toBe(1)
  })

  it('alerts on production-blocking OTP failures and activity bursts', () => {
    const rows: FlyerMonitorRow[] = Array.from({ length: 6 }, (_, index) => ({
      stage: 'otp_sent',
      phone: `+2782123000${index}`,
      at: '2026-05-29T09:00:00.000Z',
      detail: index === 0 ? 'failed' : 'sent',
      failureCode: index === 0 ? 'WA_AUTH_FAILED' : null,
    }))

    const report = analyzeFlyerMonitorRows({
      now: new Date('2026-05-29T10:00:00.000Z'),
      windowStart: new Date('2026-05-29T04:00:00.000Z'),
      windowEnd: new Date('2026-05-29T10:00:00.000Z'),
      rows,
      securityEvents: [
        {
          severity: 'HIGH',
          eventType: 'OTP_REPORTED',
          phone: '+27821230001',
          at: '2026-05-29T09:05:00.000Z',
          status: 'NEW',
        },
      ],
      lifetimeCounts: { customers: 10, providers: 4, providerApplications: 7 },
    })

    expect(report.alertLines).toEqual([
      'ALERT: 6 new prospects in this 6-hour window.',
      'ALERT: OTP delivery failure WA_AUTH_FAILED detected.',
      'ALERT: 1 HIGH/CRITICAL security event(s) in this window.',
    ])
  })
})

describe('buildFlyerMonitorReport', () => {
  it('renders zero-prospect sanity counts and next poll', () => {
    const report = analyzeFlyerMonitorRows({
      now: new Date('2026-05-29T10:13:00.000Z'),
      windowStart: new Date('2026-05-29T04:13:00.000Z'),
      windowEnd: new Date('2026-05-29T10:13:00.000Z'),
      rows: [],
      securityEvents: [],
      lifetimeCounts: { customers: 10, providers: 4, providerApplications: 7 },
    })

    const markdown = buildFlyerMonitorReport(report)

    expect(markdown).toContain('**0 prospects in this window.**')
    expect(markdown).toContain('- customers: 10')
    expect(markdown).toContain('_Next poll:')
  })

  it('renders masked prospect timelines without raw phone leakage', () => {
    const report = analyzeFlyerMonitorRows({
      now: new Date('2026-05-29T10:00:00.000Z'),
      windowStart: new Date('2026-05-29T04:00:00.000Z'),
      windowEnd: new Date('2026-05-29T10:00:00.000Z'),
      rows: [
        {
          stage: 'otp_sent',
          phone: '+27821230000',
          at: '2026-05-29T08:00:00.000Z',
          detail: 'failed',
          failureCode: 'TEMPLATE_NOT_APPROVED',
        },
      ],
      securityEvents: [],
      lifetimeCounts: { customers: 10, providers: 4, providerApplications: 7 },
    })

    const markdown = buildFlyerMonitorReport(report)

    expect(markdown).toContain('+27****0000')
    expect(markdown).toContain('TEMPLATE_NOT_APPROVED')
    expect(markdown).not.toContain('27821230000')
  })
})
