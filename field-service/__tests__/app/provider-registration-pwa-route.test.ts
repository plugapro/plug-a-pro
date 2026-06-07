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
    expect(routeSource).toContain('initialApplicationRef={destination?.applicationRef ?? null}')
    expect(clientSource).toContain('initialApplicationState?: ApplicationState | null')
    expect(clientSource).toContain('initialApplicationRef?: string | null')
    expect(clientSource).toContain('statusReference')
    expect(clientSource).toContain('more_info')
    expect(clientSource).toContain('needs more information')
    expect(clientSource).toContain('not approved yet')
    expect(clientSource).toContain('was cancelled')
  })

  it('does not strand pending applicants on the blocked evidence route', () => {
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(clientSource).toContain("actionLabel: 'Contact support'")
    expect(clientSource).toContain('supportHref(')
    expect(clientSource).not.toContain("actionHref: '/provider/register/evidence'")
  })

  it('wires the profile photo tile to a real image upload control', () => {
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(existsSync(join(root, 'app/api/provider/registration/profile-photo/route.ts'))).toBe(true)
    expect(clientSource).toContain('profilePhotoInputRef')
    expect(clientSource).toContain('handleProfilePhotoChange')
    expect(clientSource).toContain("fetch('/api/provider/registration/profile-photo'")
    expect(clientSource).toContain('profilePhotoInputRef.current?.click()')
    expect(clientSource).toContain('type="file"')
    expect(clientSource).toContain('accept="image/*"')
    expect(clientSource).toContain('onChange={handleProfilePhotoChange}')
    expect(clientSource).not.toContain('profile-photo-pending')
  })

  it('uses the shared OTP digit boxes and auto-verifies once all digits are captured', () => {
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(clientSource).toContain("import { OtpInput } from '@/components/ui/otp-input'")
    expect(clientSource).toContain('otpSubmitRef')
    expect(clientSource).toContain('form.otp.length === 6 && !verifyingCode && !otpSubmitRef.current')
    expect(clientSource).toContain('void verifyCode(form.otp)')
    expect(clientSource).toContain('<OtpInput')
    expect(clientSource).toContain('value={form.otp}')
    expect(clientSource).toContain('disabled={verifyingCode}')
    expect(clientSource).not.toContain('maxLength={6}')
    expect(clientSource).not.toContain('placeholder="123456"')
  })

  it('uses the same South African mobile input pattern as provider sign-in', () => {
    const signInSource = readFileSync(join(root, 'app/(auth)/provider-sign-in/page.tsx'), 'utf8')
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(signInSource).toContain("import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'")
    expect(clientSource).toContain("import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'")
    expect(clientSource).toContain("import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'")
    expect(clientSource).toContain('providerRegistrationPhoneInputValue')
    expect(clientSource).toContain('<SaMobileNumberInput')
    expect(clientSource).toContain('value={providerRegistrationPhoneInputValue(form.phone)}')
    expect(clientSource).toContain("onChange={(next) => update('phone', next)}")
    expect(clientSource).toContain('{SA_OTP_SIGN_IN_HELPER_TEXT}')
    expect(clientSource).not.toContain('placeholder="082 123 4567"')
  })

  it('uses canonical cascading location selectors instead of free-text area capture', () => {
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(existsSync(join(root, 'app/api/locations/provinces/route.ts'))).toBe(true)
    expect(clientSource).toContain("fetch('/api/locations/provinces'")
    expect(clientSource).toContain("fetch(`/api/locations/cities?provinceKey=${encodeURIComponent")
    expect(clientSource).toContain("fetch(`/api/locations/regions?cityId=${encodeURIComponent")
    expect(clientSource).toContain("fetch(`/api/locations/suburbs?regionId=${encodeURIComponent")
    expect(clientSource).toContain('Select a province first')
    expect(clientSource).toContain('No cities available for this province')
    expect(clientSource).toContain('No suburbs available for this region')
    expect(clientSource).not.toContain('AREA_SUGGESTIONS')
    expect(clientSource).not.toContain('areaSearch')
    expect(clientSource).not.toContain('addTypedArea')
    expect(clientSource).not.toContain('placeholder="Search suburb"')
  })

  it('uses the shared app theme tokens instead of a one-off light registration palette', () => {
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(clientSource).toContain('bg-background')
    expect(clientSource).toContain('bg-card')
    expect(clientSource).toContain('text-[var(--brand-purple)]')
    expect(clientSource).not.toContain('#F7FBFA')
    expect(clientSource).not.toContain('#F6F3FF')
    expect(clientSource).not.toContain('#0F766E')
    expect(clientSource).not.toContain('#CCFBF1')
    expect(clientSource).not.toContain('bg-white')
  })

  it('lets saved draft applicants continue into the registration steps', () => {
    const routeSource = readFileSync(join(root, 'app/provider/register/[[...step]]/page.tsx'), 'utf8')
    const clientSource = readFileSync(join(root, 'components/provider/registration/ProviderRegistrationClient.tsx'), 'utf8')

    expect(routeSource).toContain('DRAFT_CONTINUATION_STEPS')
    expect(routeSource).toContain("if (destinationRoute === '/provider/register/draft') return !DRAFT_CONTINUATION_STEPS.has(requestedStep)")
    expect(routeSource).toContain("initialDraftResumeStep={destination?.draftResumeStep ?? 'profile'}")
    expect(clientSource).toContain('initialDraftResumeStep?: StepKey')
    expect(clientSource).toContain('routeForStep(initialDraftResumeStep)')
    expect(clientSource).not.toContain("router.push('/provider/register/profile')")
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
