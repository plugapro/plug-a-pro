import { describe, it, expect } from 'vitest'
import { FEATURE_FLAGS_REGISTRY } from '@/lib/feature-flags-registry'

describe('quality gate v2 flag', () => {
  it('is registered, owned by eng, default OFF', () => {
    const entry = FEATURE_FLAGS_REGISTRY['provider.onboarding.quality_gate_v2']
    expect(entry).toBeDefined()
    expect(entry.defaultValue).toBe(false)
    expect(entry.owner).toBe('eng')
  })
})
