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
    expect(source).toContain('https://wa.me/27693552447?text=Register')
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

  it('exposes the complete design handoff screen map instead of collapsing steps', () => {
    const routeSource = readFileSync(join(root, 'app/provider/register/[[...step]]/page.tsx'), 'utf8')
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    for (const step of [
      'otp',
      'conflict',
      'verify',
      'evidence',
      'submitted',
      'draft',
      'status',
    ]) {
      expect(routeSource).toContain(`'${step}'`)
    }

    expect(clientSource).toContain('Step 8 of 8')
    expect(clientSource).toContain('Send code')
    expect(clientSource).toContain('Enter the 6-digit code')
    expect(clientSource).toContain('That number is a customer account')
    expect(clientSource).toContain('Verify later')
    expect(clientSource).toContain('Show your work')
    expect(clientSource).toContain('What happens next')
    expect(clientSource).toContain('Your application is saved')
    expect(clientSource).toContain('Verify identity to unlock credits')
  })

  it('ships registration-scoped OTP endpoints without reusing provider sign-in OTP', () => {
    expect(existsSync(join(root, 'app/api/provider/registration/send-code/route.ts'))).toBe(true)
    expect(existsSync(join(root, 'app/api/provider/registration/verify-code/route.ts'))).toBe(true)

    const sendSource = readFileSync(join(root, 'app/api/provider/registration/send-code/route.ts'), 'utf8')
    expect(sendSource).toContain('shouldCreateUser: true')
    expect(sendSource).toContain('provider_registration_send_code')
    expect(sendSource).not.toContain('findProviderForOtpLogin')
  })

  it('allows the submitted state to render after application submit before status redirect takes over', () => {
    const routeSource = readFileSync(join(root, 'app/provider/register/[[...step]]/page.tsx'), 'utf8')

    expect(routeSource).toContain(
      "if (destinationRoute === '/provider/register/status') return requestedStep !== 'status' && requestedStep !== 'submitted'",
    )
    expect(routeSource).toContain(
      "if (requestedStep === 'submitted' && destination?.route !== '/provider/register/status')",
    )
  })

  it('requires a verified registration session phone before draft or submit writes', () => {
    const draftSource = readFileSync(join(root, 'app/api/provider/registration/draft/route.ts'), 'utf8')
    const submitSource = readFileSync(join(root, 'app/api/provider/registration/submit/route.ts'), 'utf8')

    for (const source of [draftSource, submitSource]) {
      expect(source).toContain('getSession')
      expect(source).toContain('REGISTRATION_SESSION_REQUIRED')
      expect(source).toContain('REGISTRATION_PHONE_MISMATCH')
      expect(source).toContain('reference_id')
      expect(source).toContain('suggested_actions')
    }
  })
})
