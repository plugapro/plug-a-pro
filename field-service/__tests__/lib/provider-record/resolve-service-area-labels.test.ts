import { describe, it, expect } from 'vitest'
import { resolveServiceAreaLabels } from '@/lib/provider-record/resolve-service-area-labels'

const NODES = [
  { id: 'n-roode', label: 'Roodepoort', slug: 'gauteng__johannesburg__jhb_west__roodepoort', regionKey: 'jhb_west', provinceKey: 'gauteng', cityKey: 'johannesburg' },
  { id: 'n-flora', label: 'Florida', slug: 'gauteng__johannesburg__jhb_west__florida', regionKey: 'jhb_west', provinceKey: 'gauteng', cityKey: 'johannesburg' },
  { id: 'n-sunny-w', label: 'Sunnyside', slug: 'gauteng__johannesburg__jhb_west__sunnyside', regionKey: 'jhb_west', provinceKey: 'gauteng', cityKey: 'johannesburg' },
  { id: 'n-sunny-e', label: 'Sunnyside', slug: 'gauteng__ekurhuleni__ekur_east__sunnyside', regionKey: 'ekur_east', provinceKey: 'gauteng', cityKey: 'ekurhuleni' },
]
const client = { locationNode: { findMany: async () => NODES } }

describe('resolveServiceAreaLabels', () => {
  it('resolves exact labels case-insensitively and dedupes', async () => {
    const r = await resolveServiceAreaLabels(client, ['roodepoort', 'FLORIDA', 'Florida'])
    expect(r.resolvedNodeIds.sort()).toEqual(['n-flora', 'n-roode'])
    expect(r.unresolved).toEqual([])
    expect(r.ambiguous).toEqual([])
  })

  it('reports labels with no node match as unresolved', async () => {
    const r = await resolveServiceAreaLabels(client, ['Roodepoort', 'Westrand'])
    expect(r.resolvedNodeIds).toEqual(['n-roode'])
    expect(r.unresolved).toEqual(['Westrand'])
  })

  it('marks a duplicate-suburb label ambiguous without a majority region', async () => {
    const r = await resolveServiceAreaLabels(client, ['Sunnyside'])
    expect(r.resolvedNodeIds).toEqual([])
    expect(r.ambiguous).toEqual(['Sunnyside'])
  })

  it('breaks ambiguity via majority region of the other resolvable labels', async () => {
    const r = await resolveServiceAreaLabels(
      client,
      ['Roodepoort', 'Florida', 'Sunnyside'],
      { preferMajorityRegion: true },
    )
    expect(r.resolvedNodeIds.sort()).toEqual(['n-flora', 'n-roode', 'n-sunny-w'])
    expect(r.ambiguous).toEqual([])
  })
})
