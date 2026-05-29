import { describe, expect, it } from 'vitest'

/**
 * Module-load smoke test for the shared design-system components introduced
 * by the Black Apple PWA redesign. We verify each module loads cleanly,
 * exports the expected named symbol and the export is a function (React
 * component). Vitest is wired to the `node` environment in this repo, so we
 * can't actually render - that's covered by Playwright smoke. This test
 * catches import-path typos, circular dependencies and accidental
 * regressions where a component is removed or renamed.
 */
describe('shared design-system components', () => {
  it('PageHeader exports a function', async () => {
    const mod = await import('@/components/shared/PageHeader')
    expect(typeof mod.PageHeader).toBe('function')
  })

  it('ActionBar exports a function', async () => {
    const mod = await import('@/components/shared/ActionBar')
    expect(typeof mod.ActionBar).toBe('function')
  })

  it('EmptyState exports a function', async () => {
    const mod = await import('@/components/shared/EmptyState')
    expect(typeof mod.EmptyState).toBe('function')
  })

  it('ErrorState exports a function', async () => {
    const mod = await import('@/components/shared/ErrorState')
    expect(typeof mod.ErrorState).toBe('function')
  })

  it('LoadingSkeleton exports the expected variants', async () => {
    const mod = await import('@/components/shared/LoadingSkeleton')
    expect(typeof mod.Skeleton).toBe('function')
    expect(typeof mod.CardSkeleton).toBe('function')
    expect(typeof mod.ListSkeleton).toBe('function')
    expect(typeof mod.StatGridSkeleton).toBe('function')
  })

  it('StatCard exports a function', async () => {
    const mod = await import('@/components/shared/StatCard')
    expect(typeof mod.StatCard).toBe('function')
  })

  it('AlertCallout exports a function', async () => {
    const mod = await import('@/components/shared/AlertCallout')
    expect(typeof mod.AlertCallout).toBe('function')
  })

  it('FormField exports a function', async () => {
    const mod = await import('@/components/shared/FormField')
    expect(typeof mod.FormField).toBe('function')
  })

  it('CompletionMeter exports a function', async () => {
    const mod = await import('@/components/shared/CompletionMeter')
    expect(typeof mod.CompletionMeter).toBe('function')
  })

  it('ProviderCard exports a function', async () => {
    const mod = await import('@/components/shared/ProviderCard')
    expect(typeof mod.ProviderCard).toBe('function')
  })

  it('JobCard exports a function', async () => {
    const mod = await import('@/components/shared/JobCard')
    expect(typeof mod.JobCard).toBe('function')
  })

  it('MoneyInput is a forwardRef React component', async () => {
    const mod = await import('@/components/shared/MoneyInput')
    expect(mod.MoneyInput).toBeDefined()
    // forwardRef returns an object with $$typeof - verify the export is at
    // least a renderable component reference (object or function).
    const t = typeof mod.MoneyInput
    expect(t === 'object' || t === 'function').toBe(true)
  })

  it('legacy technician/JobCard re-exports the shared component', async () => {
    const legacy = await import('@/components/technician/JobCard')
    const shared = await import('@/components/shared/JobCard')
    expect(legacy.JobCard).toBe(shared.JobCard)
  })
})
