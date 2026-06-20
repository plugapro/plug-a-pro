import { describe, it, expect } from 'vitest'
import {
  classifyChannel,
  aggregateByChannel,
  aggregateBySource,
  aggregateByCampaign,
  formatChannelLabel,
  type AcquisitionRow,
} from '@/lib/admin/acquisition-aggregate'

const row = (over: Partial<AcquisitionRow>): AcquisitionRow => ({
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  paid: false,
  amount: null,
  ...over,
})

describe('classifyChannel', () => {
  it('maps utmMedium=cpc to paid_search', () => {
    expect(classifyChannel(row({ utmMedium: 'cpc' }))).toBe('paid_search')
  })

  it('maps utmMedium=paid_social to paid_social', () => {
    expect(classifyChannel(row({ utmMedium: 'paid_social' }))).toBe('paid_social')
  })

  it('maps utmMedium=organic to organic', () => {
    expect(classifyChannel(row({ utmMedium: 'organic' }))).toBe('organic')
  })

  it('maps all-null UTM to direct', () => {
    expect(classifyChannel(row({}))).toBe('direct')
  })

  it('maps unmapped medium to unknown', () => {
    expect(classifyChannel(row({ utmMedium: 'email', utmSource: 'mailchimp' }))).toBe(
      'unknown',
    )
  })

  it('is case-insensitive on medium', () => {
    expect(classifyChannel(row({ utmMedium: 'CPC' }))).toBe('paid_search')
    expect(classifyChannel(row({ utmMedium: 'Paid_Social' }))).toBe('paid_social')
  })

  it('treats only-utmSource-set as unknown, not direct', () => {
    expect(classifyChannel(row({ utmSource: 'newsletter' }))).toBe('unknown')
  })
})

describe('aggregateByChannel', () => {
  it('returns counts, paid counts, and revenue per channel', () => {
    const rows: AcquisitionRow[] = [
      row({ utmMedium: 'cpc', paid: true, amount: 1000 }),
      row({ utmMedium: 'cpc', paid: true, amount: 500 }),
      row({ utmMedium: 'cpc' }),
      row({ utmMedium: 'paid_social', paid: true, amount: 200 }),
      row({}),
      row({}),
    ]
    const result = aggregateByChannel(rows)
    const search = result.find((b) => b.key === 'paid_search')
    const social = result.find((b) => b.key === 'paid_social')
    const direct = result.find((b) => b.key === 'direct')
    expect(search).toEqual({ key: 'paid_search', bookings: 3, paidBookings: 2, revenue: 1500 })
    expect(social).toEqual({ key: 'paid_social', bookings: 1, paidBookings: 1, revenue: 200 })
    expect(direct).toEqual({ key: 'direct', bookings: 2, paidBookings: 0, revenue: 0 })
  })

  it('emits channels in the documented display order', () => {
    const rows: AcquisitionRow[] = [
      row({}),
      row({ utmMedium: 'organic' }),
      row({ utmMedium: 'cpc' }),
      row({ utmMedium: 'paid_social' }),
      row({ utmSource: 'newsletter', utmMedium: 'email' }),
    ]
    const result = aggregateByChannel(rows)
    expect(result.map((b) => b.key)).toEqual([
      'paid_search',
      'paid_social',
      'organic',
      'direct',
      'unknown',
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(aggregateByChannel([])).toEqual([])
  })

  it('does not sum revenue for unpaid bookings', () => {
    const rows: AcquisitionRow[] = [
      row({ utmMedium: 'cpc', paid: false, amount: 9999 }),
    ]
    const result = aggregateByChannel(rows)
    expect(result[0]).toEqual({
      key: 'paid_search',
      bookings: 1,
      paidBookings: 0,
      revenue: 0,
    })
  })
})

describe('aggregateBySource', () => {
  it('skips rows with null utmSource', () => {
    const rows: AcquisitionRow[] = [
      row({ utmSource: 'google', paid: true, amount: 100 }),
      row({ utmSource: null }),
      row({ utmSource: 'google', paid: true, amount: 50 }),
      row({ utmSource: 'meta' }),
    ]
    const result = aggregateBySource(rows)
    expect(result).toEqual([
      { key: 'google', bookings: 2, paidBookings: 2, revenue: 150 },
      { key: 'meta', bookings: 1, paidBookings: 0, revenue: 0 },
    ])
  })

  it('orders by bookings descending and respects the limit', () => {
    const rows: AcquisitionRow[] = Array.from({ length: 15 }, (_, i) =>
      row({ utmSource: `src${i}` }),
    )
    // Pump src0 to the top
    rows.push(row({ utmSource: 'src0' }), row({ utmSource: 'src0' }))
    const result = aggregateBySource(rows, 10)
    expect(result.length).toBe(10)
    expect(result[0].key).toBe('src0')
    expect(result[0].bookings).toBe(3)
  })
})

describe('aggregateByCampaign', () => {
  it('skips rows with null utmCampaign and orders by bookings', () => {
    const rows: AcquisitionRow[] = [
      row({ utmCampaign: 'west_rand_spring', paid: true, amount: 800 }),
      row({ utmCampaign: 'west_rand_spring' }),
      row({ utmCampaign: 'launch' }),
      row({ utmCampaign: null }),
    ]
    const result = aggregateByCampaign(rows)
    expect(result.map((b) => b.key)).toEqual(['west_rand_spring', 'launch'])
    expect(result[0].bookings).toBe(2)
    expect(result[0].revenue).toBe(800)
  })
})

describe('formatChannelLabel', () => {
  it('renders human-readable labels', () => {
    expect(formatChannelLabel('paid_search')).toBe('Paid search')
    expect(formatChannelLabel('paid_social')).toBe('Paid social')
    expect(formatChannelLabel('organic')).toBe('Organic')
    expect(formatChannelLabel('direct')).toBe('Direct')
    expect(formatChannelLabel('unknown')).toBe('Unknown')
  })

  it('passes through unknown keys verbatim', () => {
    expect(formatChannelLabel('google')).toBe('google')
  })
})
