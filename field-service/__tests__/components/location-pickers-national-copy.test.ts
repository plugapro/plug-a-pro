import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// National rollout: a location is live iff its LocationNode is active. No
// picker may render a launch-region status, and lib/location-nodes.ts must
// not stamp one. These are source-contract tests (the repo's convention for
// client components without a DOM harness — see booking-submitted-success-copy).
const root = process.cwd()
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')

const PICKER_FILES = [
  'components/provider/registration/ProviderRegistrationClient.tsx',
  'components/provider/ServiceAreaPicker.tsx',
  'components/customer/SuburbPicker.tsx',
  'components/customer/AreaSelector.tsx',
]

const REMOVED_PHRASES = [
  'serviceStatus',
  'area-service-status',
  'live for leads',
  'open to register',
  'not live yet',
  'Not yet active',
  'Leads go live in the West Rand first',
]

describe('location pickers carry no launch-region status (national rollout)', () => {
  it('lib/location-nodes.ts no longer stamps serviceStatus or imports the region gate', () => {
    const source = read('lib/location-nodes.ts')
    expect(source).not.toContain('serviceStatus')
    expect(source).not.toContain("from '@/lib/service-area-guard'")
  })

  it('the area-service-status helper module and its test are gone', () => {
    expect(existsSync(join(root, 'lib/area-service-status.ts'))).toBe(false)
    expect(existsSync(join(root, '__tests__/lib/area-service-status.test.ts'))).toBe(false)
  })

  it.each(PICKER_FILES)('%s renders no region-status copy', (file) => {
    const source = read(file)
    for (const phrase of REMOVED_PHRASES) {
      expect(source, `${file} still contains "${phrase}"`).not.toContain(phrase)
    }
  })

  it('ServiceAreaPicker still tells a suburb result from a region result', () => {
    const source = read('components/provider/ServiceAreaPicker.tsx')
    expect(source).toContain("result.nodeType === 'SUBURB' ? 'Suburb' : 'Region'")
  })
})
