import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// National rollout: provider-facing copy no longer promises a West Rand-first
// launch. These files carried the sentence after Task 7 removed the picker caveats.
const FILES = [
  'app/provider/signup/confirmation/page.tsx',
  'app/provider/signup/sections/service-areas.tsx',
  'components/provider/registration/ProviderRegistrationClient.tsx',
]

describe('provider signup copy is national', () => {
  it.each(FILES)('%s does not mention the West Rand launch order', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    expect(source).not.toContain('West Rand')
    expect(source).not.toContain('activated the moment we go live in your area')
  })

  it('the confirmation page keeps its review-timing sentence', () => {
    const source = readFileSync(join(process.cwd(), 'app/provider/signup/confirmation/page.tsx'), 'utf8')
    expect(source).toContain('most reviews happen within one business day')
  })
})
