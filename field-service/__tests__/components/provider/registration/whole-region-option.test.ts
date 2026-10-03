import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The registration client is a 'use client' component with fetch side effects;
// the selection logic is unit-tested in service-area-selection.test.ts. This
// test pins the wiring: the option exists, uses the helpers, and the
// zero-suburb message the route test depends on is still rendered.
describe('registration area step — whole-region option', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/provider/registration/ProviderRegistrationClient.tsx'),
    'utf8',
  )

  it('imports the pure selection helpers', () => {
    expect(source).toContain("from '@/components/provider/registration/service-area-selection'")
    expect(source).toContain('applyWholeRegion(')
    expect(source).toContain('applySuburbToggle(')
    expect(source).toContain('removeServiceArea(')
    expect(source).toContain('hasAnyServiceArea(')
    expect(source).toContain('isWholeRegionSelected(')
  })

  it('renders the whole-region option with the selected region label', () => {
    expect(source).toContain("My suburb isn&apos;t listed — cover the whole {region.label}")
    expect(source).toContain('onClick={selectWholeRegion}')
    expect(source).toContain('aria-pressed={wholeRegion}')
  })

  it('validation accepts a region id and says so', () => {
    expect(source).toContain("if (currentStep === 'area' && !hasAnyServiceArea(form)) {")
    expect(source).toContain("setError('Select at least one suburb from the list, or cover the whole region.')")
    expect(source).not.toContain("form.locationNodeIds.length === 0")
  })

  it('keeps the zero-suburb message and labels the chips as areas', () => {
    expect(source).toContain('No suburbs available for this region')
    expect(source).toContain('Selected areas')
    expect(source).not.toContain('Selected suburbs')
  })
})
