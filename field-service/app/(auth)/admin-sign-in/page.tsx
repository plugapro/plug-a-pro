'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { getSafeAdminNextPath } from '@/lib/safe-redirect'
import { loginAction, type LoginState } from '../login/actions'

const BRAND_GRAD =
  'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)'

const STATUS_META = [
  ['Region', 'af-south-1', false],
  ['Build', process.env.NEXT_PUBLIC_BUILD_REF ?? 'web@2026.05.19', false],
  ['Tenant', 'plugapro · admin', false],
  ['Status', 'all systems normal', true],
] as const

function StatusDot({ color = '#5BE584', reduced = false, pulse = true }: {
  color?: string
  reduced?: boolean
  pulse?: boolean
}) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${
        reduced ? 'admin-status-dot-reduced' : 'admin-status-dot'
      }`}
      aria-hidden
      style={{
        background: color,
        boxShadow: pulse ? `0 0 0 0 ${color}55` : 'none',
        animation: pulse ? 'admin-pulse 2s ease-out infinite' : 'none',
      }}
    />
  )
}

function BrandPanel() {
  return (
    <aside
      className="relative hidden w-[480px] shrink-0 flex-col overflow-hidden border-r border-[#1B1B24] lg:flex"
      style={{ padding: '40px 44px', background: 'linear-gradient(120% 80% at 0% 0%, #1A1428 0%, #0A0A12 55%, #08080C 100%)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'linear-gradient(to bottom, black 30%, transparent 90%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: -120,
          top: 120,
          width: 420,
          height: 420,
          background: 'radial-gradient(circle, rgba(139,63,232,0.33) 0%, transparent 65%)',
          filter: 'blur(40px)',
        }}
      />

      <div className="relative z-10 flex items-center gap-3.5">
        <Image src="/logo.png" alt="Plug A Pro" width={36} height={36} priority />
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[17px] font-extrabold tracking-tight"
            style={{
              background: BRAND_GRAD,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Plug A Pro
          </span>
          <span
            className="text-[10.5px] uppercase tracking-[0.12em] text-[#6E6E78]"
            style={{ fontFamily: 'var(--font-mono-admin)' }}
          >
            Admin Console
          </span>
        </div>
      </div>

      <div className="relative z-10 mt-auto">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em]" style={{
          background: 'rgba(139,63,232,0.12)',
          borderColor: 'rgba(139,63,232,0.30)',
          color: '#D9C8FF',
          fontFamily: 'var(--font-mono-admin)',
        }}>
          <StatusDot reduced pulse color="#8B3FE8" />
          Internal · Admin Portal
        </div>

        <h1
          className="m-0 max-w-[360px] text-[56px] font-bold leading-[1.02] tracking-[-0.04em] text-[#FAFAFB]"
          style={{ fontFamily: 'var(--font-sans-admin)' }}
        >
          Restricted access.
          <br />
          <span
            style={{
              background: BRAND_GRAD,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Operators only.
          </span>
        </h1>

        <p className="mt-4 max-w-[340px] text-[14.5px] leading-[1.55] text-[#9A9AA6]">
          Use your Plug A Pro work account. SSO and second-factor are enforced for every session.
        </p>

        <div className="relative z-10 mt-12 grid grid-cols-2 gap-x-[18px] gap-y-[14px] border-t border-[#1B1B24] pt-[18px] text-[10.5px] font-[var(--font-mono-admin)]">
          {STATUS_META.map(([k, v, showDot]) => (
            <div key={k}>
              <div className="mb-1 uppercase tracking-[1.3px] text-[#5C5C68]">{k}</div>
              <div className="flex items-center gap-1.5 text-[#C8C8D2]">
                {showDot && <StatusDot />}
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function MobileBrandBanner() {
  return (
    <div className="lg:hidden border-b border-[#1B1B24] bg-[#08080C] px-6 py-5">
      <div className="mb-3 flex items-center gap-3">
        <Image src="/logo.png" alt="Plug A Pro" width={36} height={36} />
        <div className="flex flex-col gap-0.5">
          <span className="text-[17px] font-extrabold tracking-tight" style={{
            background: BRAND_GRAD,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontFamily: 'var(--font-sans-admin)',
          }}>
            Plug A Pro
          </span>
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#6E6E78]" style={{ fontFamily: 'var(--font-mono-admin)' }}>
            Admin Console
          </span>
        </div>
      </div>

      <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(139,63,232,0.30)] px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-[#D9C8FF]" style={{
        background: 'rgba(139,63,232,0.12)',
        fontFamily: 'var(--font-mono-admin)',
      }}>
        <StatusDot reduced pulse color="#8B3FE8" />
        Internal · Admin Portal
      </div>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  right,
  error,
  children,
}: {
  label: string
  htmlFor: string
  right?: React.ReactNode
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label
          htmlFor={htmlFor}
          className="text-[10.5px] font-[var(--font-mono-admin)] uppercase tracking-[0.12em] text-[#9A9AA6]"
        >
          {label}
        </Label>
        {right}
      </div>
      {children}
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] font-[var(--font-mono-admin)] tracking-wide text-[#FF8AA0]">
          <span>
            <AlertIcon />
          </span>
          {error}
        </div>
      )}
    </div>
  )
}

function StyledInput({
  icon,
  rightIcon,
  hasError,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  icon?: React.ReactNode
  rightIcon?: React.ReactNode
  hasError?: boolean
}) {
  const [focused, setFocused] = useState(false)

  const borderColor = hasError ? '#7A2E3E' : focused ? '#3A2A66' : '#1F1F28'
  const shadow = hasError ? '0 0 0 4px rgba(255,83,112,0.13)' : focused ? '0 0 0 4px rgba(139,63,232,0.13)' : 'none'

  return (
    <div
      className="flex h-[52px] items-center gap-[10px] rounded-[12px] px-[14px] transition-[border-color,box-shadow] duration-150"
      style={{ background: '#101018', border: `1px solid ${borderColor}`, boxShadow: shadow }}
    >
      {icon && (
        <span
          className="flex shrink-0 transition-colors duration-150"
          style={{ color: focused ? '#B8A8FF' : '#5C5C68' }}
        >
          {icon}
        </span>
      )}

      <Input
        {...rest}
        onFocus={(event) => {
          setFocused(true)
          rest.onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          rest.onBlur?.(event)
        }}
        className="h-auto flex-1 border-0 bg-transparent p-0 text-[14.5px] text-[#FAFAFB] placeholder:text-[#5C5C68] focus-visible:ring-0 focus-visible:ring-offset-0"
        style={{ padding: 0 }}
      />

      {rightIcon}
    </div>
  )
}

function SubmitButton({
  pending,
  disabled,
  label = 'Sign in to admin',
}: {
  pending: boolean
  disabled?: boolean
  label?: string
}) {
  return (
    <Button
      type="submit"
      className="relative mt-1.5 h-[54px] w-full justify-between overflow-hidden rounded-[14px] border border-white/10 px-[22px] text-[14.5px] font-semibold tracking-[0.014em] text-[#FAFAFB] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled || pending}
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        fontFamily: 'var(--font-sans-admin)',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[14px] p-px opacity-45"
        style={{
          background: BRAND_GRAD,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />

      <span className="relative flex items-center gap-2.5">
        {pending ? <SpinnerIcon /> : <ShieldIcon size={14} />}
        {pending ? 'Verifying…' : label}
      </span>
      {!pending && <ArrowIcon />}
    </Button>
  )
}

function OrDivider() {
  return (
    <div className="mt-1 flex items-center gap-3 text-[10.5px] font-[var(--font-mono-admin)] tracking-[0.12em] text-[#5C5C68]">
      <span className="h-px flex-1 bg-[#1B1B24]" />
      <span className="uppercase">or</span>
      <span className="h-px flex-1 bg-[#1B1B24]" />
    </div>
  )
}

function SsoButton() {
  return (
    <button
      type="button"
      className="mt-1 flex h-[46px] w-full items-center justify-center gap-2.5 rounded-xl border border-[#1F1F28] bg-transparent text-[13.5px] font-medium text-[#C8C8D2] transition-colors hover:bg-white/[0.02]"
      onClick={() => {
        window.location.href = '/admin-sign-in?sso=google'
      }}
    >
      <KeyIcon />
      Continue with SSO (Google Workspace)
    </button>
  )
}

function OtpInput({
  value,
  onChange,
  pending,
}: {
  value: string
  onChange: (next: string) => void
  pending: boolean
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  function focusNext(idx: number) {
    const next = inputs.current[idx + 1]
    if (!next) return
    next.focus()
  }

  function focusPrev(idx: number) {
    const previous = inputs.current[idx - 1]
    if (!previous) return
    previous.focus()
  }

  function updateFromPaste(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 6).split('')
    if (!digits.length) return

    const next = Array.from({ length: 6 }, (_, idx) => digits[idx] ?? '')
    onChange(next.join(''))

    const lastFilled = Math.min(digits.length - 1, 5)
    inputs.current[lastFilled]?.focus()
  }

  return (
    <div className="mb-5 grid grid-cols-6 gap-[10px]">
      {Array.from({ length: 6 }, (_, idx) => {
        const digit = value[idx] ?? ''

        return (
          <input
            key={idx}
            ref={(node) => {
              inputs.current[idx] = node
            }}
            name="otp"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            disabled={pending}
            onPaste={(event) => {
              event.preventDefault()
              updateFromPaste(event.clipboardData.getData('text'))
            }}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, '').slice(-1)
              const current = value.padEnd(6, '').split('')
              current[idx] = next
              onChange(current.join(''))

              if (next && idx < 5) focusNext(idx)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && !digit && idx > 0) {
                focusPrev(idx)
              }

              if (event.key === 'ArrowLeft') {
                focusPrev(idx)
              }

              if (event.key === 'ArrowRight') {
                focusNext(idx)
              }
            }}
            className="h-[64px] rounded-[12px] bg-[#101018] text-center font-[var(--font-mono-admin)] text-[28px] leading-none text-[#FAFAFB] outline-none transition-[border-color,box-shadow] duration-150"
            style={{
              border: `1px solid ${digit ? '#3A2A66' : '#1F1F28'}`,
              boxShadow: digit ? '0 0 0 4px rgba(139,63,232,0.13)' : 'none',
              fontFamily: 'var(--font-sans-admin)',
            }}
          />
        )
      })}
    </div>
  )
}

function TwoFactorStep({
  formEmail,
  formAction,
  pending,
  locked,
}: {
  formEmail: string
  formAction: (formData: FormData) => void
  pending: boolean
  locked: number
}) {
  const [otp, setOtp] = useState('')

  return (
    <>
      <div
        className="mb-4 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10.5px] font-[var(--font-mono-admin)] uppercase tracking-[1px] text-[#9CECB1]"
        style={{ background: 'rgba(91,229,132,0.1)', borderColor: 'rgba(91,229,132,0.25)' }}
      >
        <ShieldIcon size={12} />
        Step 2 of 2
      </div>

      <h2 className="m-0 text-[32px] font-bold leading-[1.2] tracking-[-0.03em] text-[#FAFAFB]" style={{ fontFamily: 'var(--font-sans-admin)' }}>
        Confirm with 2FA
      </h2>

      <p className="mt-2 mb-8 text-[14.5px] leading-[1.5] text-[#7E7E8A]">
        Enter the 6-digit code from your authenticator app. Codes refresh every 30 seconds.
      </p>

      <form action={formAction} className="flex flex-col gap-[22px]">
        <input type="hidden" name="next" value="/admin" />
        <input type="hidden" name="email" value={formEmail} />

        <OtpInput value={otp} onChange={setOtp} pending={pending} />

        <SubmitButton
          pending={pending}
          disabled={otp.length !== 6 || pending}
          label="Confirm & continue"
        />

        <a
          href="#"
          className="mt-1 text-center text-[10.5px] font-[var(--font-mono-admin)] text-[#9A8AE8] underline underline-offset-4"
          style={{ letterSpacing: '0.1em' }}
        >
          use backup code
        </a>
      </form>

      <div className="mt-7 rounded-[12px] border border-[#1F1F28] bg-[#101018] p-5">
        <p className="mb-1 text-[10.5px] uppercase tracking-[1px] text-[#7E7E8A]" style={{ fontFamily: 'var(--font-mono-admin)' }}>
          Locked in
        </p>
        <p className="mt-1 font-[var(--font-mono-admin)] text-[28px] leading-none tracking-[0.08em] text-[#FAFAFB]">
          {String(Math.floor(locked / 60)).padStart(2, '0')} : {String(locked % 60).padStart(2, '0')}
        </p>
      </div>
    </>
  )
}

function LockedState({ retryAfter = 14 * 60 + 27 }: { retryAfter?: number }) {
  const [secondsLeft, setSecondsLeft] = useState(retryAfter)

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          clearInterval(timer)
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [retryAfter])

  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const seconds = String(secondsLeft % 60).padStart(2, '0')

  return (
    <>
      <div
        className="mb-4 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10.5px] font-[var(--font-mono-admin)] uppercase tracking-[0.1em] text-[#FF8AA0]"
        style={{ background: 'rgba(255,80,100,0.1)', borderColor: 'rgba(255,80,100,0.3)' }}
      >
        <AlertIcon />
        Account locked
      </div>

      <h2 className="m-0 text-[32px] font-bold leading-[1.2] tracking-[-0.03em] text-[#FAFAFB]" style={{ fontFamily: 'var(--font-sans-admin)' }}>
        Too many attempts
      </h2>

      <p className="mb-9 mt-2 text-[14.5px] leading-[1.55] text-[#9A9AA6]">
        We&apos;ve locked sign-in for this account. Retry after the countdown.
      </p>

      <div className="flex items-center justify-between rounded-[12px] border border-[#1F1F28] bg-[#101018] p-5">
        <div>
          <p className="mb-1 text-[10.5px] uppercase tracking-[1px] text-[#7E7E8A]" style={{ fontFamily: 'var(--font-mono-admin)' }}>
            Unlocks in
          </p>
          <p className="font-[var(--font-mono-admin)] text-[28px] leading-none tracking-[0.08em] text-[#FAFAFB]">
            {minutes} : {seconds}
          </p>
        </div>
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(255,80,100,0.25)] text-[#FF8AA0]" style={{ background: 'rgba(255,80,100,0.08)' }}>
          <AlertIcon />
        </span>
      </div>

      <div className="mt-6">
        <SubmitButton disabled label="Sign in disabled" pending={false} />
      </div>
    </>
  )
}

function ErrorBanner({
  attemptsUsed,
  attemptsMax,
  email,
  errorCode,
}: {
  attemptsUsed?: number
  attemptsMax?: number
  email?: string
  errorCode?: string
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-5 flex items-start gap-2.5 rounded-xl border p-3.5"
      style={{ background: 'rgba(255,80,100,0.06)', borderColor: 'rgba(255,80,100,0.22)' }}
    >
      <span className="mt-0.5 flex shrink-0 text-[#FF8AA0]">
        <AlertIcon />
      </span>
      <div>
        <div className="font-semibold text-[#FFC8D0]" style={{ fontSize: '13.5px' }}>
          We couldn&apos;t sign you in.
        </div>
        <div className="mt-0.5 text-[10.5px] tracking-[0.04em] text-[#FF8AA0]" style={{ fontFamily: 'var(--font-mono-admin)' }}>
          {errorCode ?? 'err·auth/invalid-credentials'}
          {attemptsUsed != null && attemptsMax != null ? ` · ${attemptsUsed} of ${attemptsMax} attempts used` : ''}
          {email ? ` · ${email}` : ''}
        </div>
      </div>
    </div>
  )
}

const initialState: LoginState = { status: 'idle' }

export default function AdminSignInPage() {
  const searchParams = useSearchParams()
  const [state, formAction, pending] = useActionState(loginAction, initialState)
  const [showPassword, setShowPassword] = useState(false)
  const [next] = useState(() => {
    return getSafeAdminNextPath(
      searchParams.get('next') ?? searchParams.get('callbackUrl'),
      '/admin',
    )
  })

  const isError = state.status === 'error'
  const is2fa = state.status === '2fa-required'
  const isLocked = state.status === 'locked'

  const handleFormAction = (formData: FormData) => {
    setShowPassword(false)
    return formAction(formData)
  }

  return (
    <div className="flex min-h-screen w-full overflow-hidden">
      <style>{`
        @keyframes admin-pulse {
          0% { box-shadow: 0 0 0 0 rgba(91,229,132,0.4); }
          70% { box-shadow: 0 0 0 6px rgba(91,229,132,0); }
          100% { box-shadow: 0 0 0 0 rgba(91,229,132,0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .admin-status-dot {
            animation: none !important;
          }
        }
      `}</style>

      <BrandPanel />
      <div className="min-h-screen flex-1 overflow-hidden">
        <MobileBrandBanner />

        <main className="relative flex min-h-0 flex-1 flex-col bg-[#0E0E14]">
          <div className="px-6 pt-[28px] lg:px-24">
            <div className="flex items-center justify-between text-[10.5px] text-[#5C5C68]" style={{ fontFamily: 'var(--font-mono-admin)' }}>
              <span>plugapro.co.za / admin / sign-in</span>
              <span className="flex items-center gap-2.5">
                <StatusDot color="#5BE584" />
                SECURE · TLS 1.3 · sess-7f4a
              </span>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center">
            <div className="w-full max-w-[440px] px-6 py-10 lg:px-0 lg:py-0 lg:pl-24">
              <h2 className="m-0 text-[32px] font-bold leading-[1.2] tracking-[-0.025em] text-[#FAFAFB]" style={{ fontFamily: 'var(--font-sans-admin)' }}>
                Team sign in
              </h2>
              <p className="mb-9 mt-2 text-[14.5px] leading-[1.5] text-[#7E7E8A]">
                Authenticate with your work email to access ops, dispatch, and audit tools.
              </p>

              {isError && (
                <ErrorBanner
                  attemptsMax={state.attemptsMax}
                  attemptsUsed={state.attemptsUsed}
                  email={state.email}
                  errorCode={state.errorCode}
                />
              )}

              {isLocked && <LockedState retryAfter={state.retryAfter} />}

              {!isLocked && !is2fa && (
                <form action={handleFormAction} className="flex flex-col gap-[22px]">
                  <input type="hidden" name="next" value={next} />

                  <Field label="Work email" htmlFor="email">
                    <StyledInput
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      autoFocus
                      placeholder="you@plugapro.co.za"
                      defaultValue={state.status === 'error' ? state.email : ''}
                      icon={<MailIcon />}
                    />
                  </Field>

                  <Field
                    label="Password"
                    htmlFor="password"
                    error={isError ? 'Email or password is incorrect.' : undefined}
                    right={
                      <a
                        href="/forgot-password"
                        className="font-[var(--font-mono-admin)] text-[10.5px] uppercase tracking-[0.12em] text-[#9A8AE8] hover:text-[#B8A8FF]"
                      >
                        Forgot?
                      </a>
                    }
                  >
                    <StyledInput
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      placeholder="••••••••••"
                      icon={<LockIcon />}
                      hasError={isError}
                      rightIcon={
                        <button
                          type="button"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="flex shrink-0 border-0 bg-transparent p-1 text-[#7E7E8A]"
                          onClick={() => setShowPassword((value) => !value)}
                        >
                          {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      }
                    />
                  </Field>

                  <SubmitButton pending={pending} />
                  <OrDivider />
                  <SsoButton />
                </form>
              )}

              {is2fa && (
                <TwoFactorStep
                  formAction={formAction}
                  pending={pending}
                  formEmail={state.email ?? ''}
                  locked={14 * 60 + 27}
                />
              )}
            </div>
          </div>

          <footer
            className="sticky bottom-0 mt-auto flex items-center justify-between border-t border-[#1B1B24] px-6 py-3.5 text-[10.5px] tracking-[0.11em] text-[#5C5C68] lg:px-24"
            style={{ fontFamily: 'var(--font-mono-admin)' }}
          >
            <span className="flex items-center gap-2.5">
              <ShieldIcon size={13} />
              All actions are logged and audited. Unauthorized access is prohibited.
            </span>
            <span>v 2.4.1 · © Plug A Pro</span>
          </footer>
        </main>
      </div>
    </div>
  )
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="11" rx="2" />
      <path d="M3.5 6.5l6.5 5 6.5-5" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="9" width="12" height="9" rx="2" />
      <path d="M7 9V6.5a3 3 0 016 0V9" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 10S4 4.5 10 4.5 18.5 10 18.5 10 16 15.5 10 15.5 1.5 10 1.5 10z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l14 14M9 5a8 8 0 019.5 5 9 9 0 01-1.7 2.4M6 6.5A9 9 0 001.5 10S4 15.5 10 15.5a8 8 0 003.5-.8M8.5 8.5a2 2 0 002.8 2.8" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  )
}

function ShieldIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5l6 2v5c0 4-2.7 7-6 8-3.3-1-6-4-6-8v-5l6-2z" />
      <path d="M7 10l2 2 4-4" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="13" r="3" />
      <path d="M9 11l7-7M13.5 6.5L15 8M11.5 8.5L13 10" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6.5v4M10 13.4v.1" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
    >
      <circle cx="10" cy="10" r="7" opacity=".18" />
      <path d="M17 10a7 7 0 00-7-7" />
    </svg>
  )
}
