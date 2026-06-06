import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('provider registration PWA route surface', () => {
  it('ships a real provider registration route and API handlers', () => {
    expect(existsSync(join(root, 'app/provider/register/[[...step]]/page.tsx'))).toBe(true)
    expect(existsSync(join(root, 'app/api/provider/registration/draft/route.ts'))).toBe(true)
    expect(existsSync(join(root, 'app/api/provider/registration/submit/route.ts'))).toBe(true)
  })

  it('links provider sign-in applicants to the PWA registration path', () => {
    const source = readFileSync(join(root, 'app/(auth)/provider-sign-in/page.tsx'), 'utf8')

    expect(source).toContain('/provider/register')
    expect(source).toContain('Register as a Service Provider')
  })

  it('links the customer home provider card directly to the PWA registration path', () => {
    const source = readFileSync(join(root, 'app/(customer)/page.tsx'), 'utf8')

    expect(source).toContain('href="/provider/register"')
    expect(source).not.toContain('href="/for-providers"')
  })

  it('links customer sign-in users to provider registration without entering provider OTP', () => {
    const source = readFileSync(join(root, 'app/(auth)/sign-in/page.tsx'), 'utf8')

    expect(source).toContain('Want to offer services?')
    expect(source).toContain('Register as a Service Provider')
    expect(source).toContain('href="/provider/register"')
  })

  it('emits non-blocking registration start and resume events from the client flow', () => {
    const source = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(source).toContain('provider_registration_start')
    expect(source).toContain('provider_registration_resume')
    expect(source).toContain('console.info(JSON.stringify')
  })

  it('preserves authenticated application status when rendering the status route', () => {
    const routeSource = readFileSync(join(root, 'app/provider/register/[[...step]]/page.tsx'), 'utf8')
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(routeSource).toContain('initialApplicationState={destination?.state ?? null}')
    expect(clientSource).toContain('initialApplicationState?: ApplicationState | null')
    expect(clientSource).toContain('more_info')
    expect(clientSource).toContain('needs more information')
    expect(clientSource).toContain('not approved yet')
    expect(clientSource).toContain('was cancelled')
  })
})
