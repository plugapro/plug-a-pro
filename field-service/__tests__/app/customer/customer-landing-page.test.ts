import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CustomerHomePage from '@/app/(customer)/page'

describe('customer mobile landing page', () => {
  it('renders clear customer and provider CTAs', async () => {
    const html = renderToStaticMarkup(await CustomerHomePage())

    expect(html).toContain('Find trusted service providers near you')
    expect(html).toContain('Find a provider')
    expect(html).toContain('Request a service')
    expect(html).toContain('Join as a service provider')
  })

  it('renders required category shortcuts', async () => {
    const html = renderToStaticMarkup(await CustomerHomePage())

    expect(html).toContain('Plumbing')
    expect(html).toContain('Handyman')
    expect(html).toContain('Electrical')
    expect(html).toContain('Carpentry')
    expect(html).toContain('Cleaning')
    expect(html).toContain('Painting')
    expect(html).toContain('Appliance Repairs')
    expect(html).toContain('Geyser')
  })
})
