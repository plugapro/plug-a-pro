'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import Image from 'next/image'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSafeAdminNextPath } from '@/lib/safe-redirect'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ─── Brand ─────────────────────────────────────────────────────────────────
const BRAND_GRAD = 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)'

// ─── Icons ──────────────────────────────────────────────────────────────────
function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="11" rx="2" /><path d="M3.5 6.5l6.5 5 6.5-5" />
    </svg>
  )
}
function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="9" width="12" height="9" rx="2" /><path d="M7 9V6.5a3 3 0 016 0V9" />
    </svg>
  )
}
function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 10S4 4.5 10 4.5 18.5 10 18.5 10 16 15.5 10 15.5 1.5 10 1.5 10z" /><circle cx="10" cy="10" r="2.5" />
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
      <path d="M10 2.5l6 2v5c0 4-2.7 7-6 8-3.3-1-6-4-6-8v-5l6-2z" /><path d="M7 10l2 2 4-4" />
    </svg>
  )
}
function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7.5" /><path d="M10 6.5v4M10 13.4v.1" />
    </svg>
  )
}
function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <circle cx="10" cy="10" r="7" opacity=".18" /><path d="M17 10a7 7 0 00-7-7" />
    </svg>
  )
}

// ─── Atoms ─────────────────────────────────────────────────────────────────
function StatusDot({ color = '#5BE584' }: { color?: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color, animation: 'admin-pulse 2s ease-out infinite' }}
    />
  )
}

// ─── Brand panel ───────────────────────────────────────────────────────────
function BrandPanel() {
  return (
    <aside
      className="relative hidden w-[480px] shrink-0 flex-col overflow-hidden border-r border-[#1B1B24] lg:flex"
      style={{
        padding: '40px 44px',
        background: 'radial-gradient(120% 80% at 0% 0%, #1A1428 0%, #0A0A12 55%, #08080C 100%)',
      }}
    >
      {/* hairline grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'linear-gradient(to bottom, black 30%, transparent 90%)',
        }}
      />
      {/* gradient orb */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: -120, top: 120, width: 420, height: 420, background: 'radial-gradient(circle, rgba(139,63,232,0.33) 0%, transparent 65%)', filter: 'blur(40px)' }}
      />

      {/* wordmark */}
      <div className="relative z-10 flex items-center gap-3.5">
        <Image src="/icon.png" alt="Plug A Pro" width={36} height={36} priority />
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[17px] font-extrabold tracking-tight"
            style={{ background: BRAND_GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            Plug A Pro
          </span>
          <span className="text-[10.5px] uppercase tracking-wider text-[#6E6E78]" style={{ fontFamily: 'var(--font-mono)' }}>
            Admin Console
          </span>
        </div>
      </div>

      {/* statement */}
      <div className="relative z-10 mt-auto">
        <div className="mb-6">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5"
            style={{ background: 'rgba(139,63,232,0.12)', borderColor: 'rgba(139,63,232,0.30)', color: '#D9C8FF', fontFamily: 'var(--font-mono)', fontSize: '10.5px', letterSpacing: '0.12em', textTransform: 'uppercase' }}
          >
            <StatusDot color="#8B3FE8" />
            Internal · Admin Portal
          </div>
        </div>
        <h1
          className="m-0 max-w-[360px] font-bold text-[#FAFAFB]"
          style={{ fontSize: '56px', lineHeight: 1.02, letterSpacing: '-0.04em', fontFamily: 'var(--font-ui)' }}
        >
          Restricted access.
          <br />
          <span style={{ background: BRAND_GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Operators only.
          </span>
        </h1>
        <p className="mt-4 max-w-[340px] leading-[1.55] text-[#9A9AA6]" style={{ fontSize: '14.5px' }}>
          Use your Plug A Pro work account. SSO and second-factor are enforced for every session.
        </p>
      </div>

      {/* metadata grid */}
      <div
        className="relative z-10 mt-12 grid grid-cols-2 border-t border-[#1B1B24] pt-[18px]"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', gap: '14px 18px' }}
      >
        {([
          ['Region', 'af-south-1', false],
          ['Build', process.env.NEXT_PUBLIC_BUILD_REF ?? 'web@dev', false],
          ['Tenant', 'plugapro · admin', false],
          ['Status', 'all systems normal', true],
        ] as [string, string, boolean][]).map(([k, v, dot]) => (
          <div key={k}>
            <div className="mb-1 uppercase tracking-wider text-[#5C5C68]">{k}</div>
            <div className="flex items-center gap-1.5 text-[#C8C8D2]">
              {dot && <StatusDot />}
              {v}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

// ─── Styled input ───────────────────────────────────────────────────────────
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
      className="flex items-center gap-2.5 rounded-xl px-3.5 transition-[border-color,box-shadow] duration-150"
      style={{ background: '#101018', border: `1px solid ${borderColor}`, boxShadow: shadow, height: '52px' }}
    >
      {icon && (
        <span className="flex shrink-0 transition-colors duration-150" style={{ color: focused ? '#B8A8FF' : '#5C5C68' }}>
          {icon}
        </span>
      )}
      <Input
        {...rest}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e) }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e) }}
        className="h-auto flex-1 border-0 bg-transparent p-0 text-[#FAFAFB] placeholder:text-[#5C5C68] focus-visible:ring-0 focus-visible:ring-offset-0"
        style={{ fontSize: '14.5px' }}
      />
      {rightIcon}
    </div>
  )
}

// ─── Submit button ──────────────────────────────────────────────────────────
function SubmitButton({ loading, disabled }: { loading: boolean; disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className="relative mt-1.5 flex w-full items-center justify-between overflow-hidden rounded-[14px] border border-white/10 px-[22px] font-semibold text-[#FAFAFB] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      style={{ height: '54px', fontSize: '14.5px', letterSpacing: '0.014em', background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', fontFamily: 'var(--font-ui)' }}
    >
      {/* gradient hairline border */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[14px] p-px opacity-45"
        style={{ background: BRAND_GRAD, WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude' }}
      />
      <span className="flex items-center gap-2.5">
        {loading ? <SpinnerIcon /> : <ShieldIcon size={14} />}
        {loading ? 'Verifying…' : 'Sign in to admin'}
      </span>
      {!loading && <ArrowIcon />}
    </button>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function AdminSignInPage() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgotSent, setForgotSent] = useState(false)
  const next = getSafeAdminNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/admin',
  )

  const isValid = email.includes('@') && password.length >= 4

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = getSupabaseClient()
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })

      if (signInError || !data.user) {
        setError('Invalid email or password.')
        return
      }

      if (!data.session?.access_token) {
        setError('Could not establish a session. Please try again.')
        return
      }

      const sessionRes = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.session.access_token, expiresIn: data.session.expires_in ?? 3600, requireAdmin: true }),
      })

      if (sessionRes.status === 403) {
        try { await supabase.auth.signOut() } catch { /* best-effort */ }
        setError('Your account does not have admin access.')
        return
      }

      if (!sessionRes.ok) {
        setError('Failed to establish session. Please try again.')
        return
      }

      window.location.assign(next)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <style>{`
        @keyframes admin-pulse {
          0%   { box-shadow: 0 0 0 0   rgba(91,229,132,0.4); }
          70%  { box-shadow: 0 0 0 6px rgba(91,229,132,0);   }
          100% { box-shadow: 0 0 0 0   rgba(91,229,132,0);   }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="admin-pulse"] { animation: none !important; }
        }
      `}</style>

      <BrandPanel />

      <main className="relative flex flex-1 flex-col bg-[#0E0E14]">
        {/* top status row */}
        <div
          className="flex items-center justify-between px-11 pt-7 text-[#5C5C68]"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.06em' }}
        >
          <span>plugapro.co.za / admin / sign-in</span>
          <span className="flex items-center gap-2.5">
            <StatusDot />
            SECURE · TLS 1.3
          </span>
        </div>

        {/* form column */}
        <div className="flex flex-1 flex-col justify-center px-6 lg:px-24">
          <div className="mx-auto w-full max-w-[440px] lg:mx-0">
            <h2
              className="m-0 font-bold text-[#FAFAFB]"
              style={{ fontSize: '32px', lineHeight: 1.2, letterSpacing: '-0.025em', fontFamily: 'var(--font-ui)' }}
            >
              Team sign in
            </h2>
            <p className="mb-9 mt-2 leading-[1.5] text-[#7E7E8A]" style={{ fontSize: '14.5px' }}>
              Authenticate with your work email to access ops, dispatch, and audit tools.
            </p>

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="mb-5 flex items-start gap-2.5 rounded-xl border p-3.5"
                style={{ background: 'rgba(255,80,100,0.06)', borderColor: 'rgba(255,80,100,0.22)' }}
              >
                <span className="mt-0.5 flex shrink-0 text-[#FF8AA0]"><AlertIcon /></span>
                <div>
                  <div className="font-semibold text-[#FFC8D0]" style={{ fontSize: '13.5px' }}>
                    We couldn't sign you in.
                  </div>
                  <div
                    className="mt-0.5 tracking-wide text-[#FF8AA0]"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}
                  >
                    {error}
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-[22px]">
              <div>
                <Label
                  htmlFor="admin-email"
                  className="mb-2 block border-0 bg-transparent p-0 text-[#9A9AA6]"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.12em' }}
                >
                  Work email
                </Label>
                <StyledInput
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@plugapro.co.za"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null) }}
                  required
                  disabled={loading}
                  autoFocus
                  icon={<MailIcon />}
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label
                    htmlFor="admin-password"
                    className="border-0 bg-transparent p-0 text-[#9A9AA6]"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.12em' }}
                  >
                    Password
                  </Label>
                  <button
                    type="button"
                    onClick={() => setForgotSent(true)}
                    className="text-[#9A8AE8] transition-colors hover:text-[#B8A8FF]"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.12em', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Forgot?
                  </button>
                </div>
                {forgotSent && (
                  <p className="mb-2 text-[12px] text-[#9A9AA6]">
                    Contact your Plug A Pro administrator to reset your password.
                  </p>
                )}
                <StyledInput
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null) }}
                  required
                  disabled={loading}
                  hasError={!!error}
                  icon={<LockIcon />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="flex shrink-0 cursor-pointer border-0 bg-transparent p-1 text-[#7E7E8A] transition-colors hover:text-[#C8C8D2]"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  }
                />
              </div>

              <SubmitButton loading={loading} disabled={!isValid} />
            </form>
          </div>
        </div>

        {/* audit footer */}
        <footer
          className="flex items-center justify-between border-t border-[#1B1B24] px-11 py-3.5 text-[#5C5C68]"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', letterSpacing: '0.06em' }}
        >
          <span className="flex items-center gap-2.5">
            <ShieldIcon size={13} />
            All actions are logged and audited. Unauthorized access is prohibited.
          </span>
          <span>© Plug A Pro</span>
        </footer>
      </main>
    </div>
  )
}
