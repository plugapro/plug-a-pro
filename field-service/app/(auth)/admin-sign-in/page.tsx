'use client'

import { useActionState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthShell } from '@/components/shared/auth-shell'
import { getSafeAdminNextPath } from '@/lib/safe-redirect'
import { loginAction, type LoginState } from '../login/actions'

const initialState: LoginState = { status: 'idle' }

function formatLoginError(state: LoginState): string | null {
  if (state.status === 'error') {
    switch (state.errorCode) {
      case 'err/auth/invalid-request':
        return 'Enter a valid email address and your password.'
      case 'err/auth/invalid-credentials':
      case 'err/auth/not-admin':
        return 'These credentials are not authorized for admin access. Contact your team owner if you need access.'
      case 'err/auth/no-session':
        return 'We could not establish a session. Try again.'
      case 'err/auth/locked':
        return 'This account is temporarily locked. Try again later.'
      case 'err/auth/service-unavailable':
      default:
        return 'Sign-in service is unavailable right now. Please try again.'
    }
  }

  if (state.status === 'locked') {
    const waitMs = state.retryAfter ? `${Math.ceil(state.retryAfter / 60)} minutes` : 'a few minutes'
    return `Account temporarily locked. Retry in ${waitMs}.`
  }

  if (state.status === '2fa-required') {
    return state.message ?? 'Additional authentication is required for this account.'
  }

  return null
}

export default function AdminSignInPage() {
  // Use action state to keep the page reactive to loginAction errors without
  // extra client-side authentication plumbing.
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, initialState)
  const searchParams = useSearchParams()

  // Preserve the callback target only for valid admin routes to avoid role-mixing redirects.
  const callbackTarget = getSafeAdminNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/admin',
  )

  const errorMessage = formatLoginError(state)

  return (
    <AuthShell
      eyebrow="Operations"
      title="Sign in to the ops dashboard"
      subtitle="Use your admin email and password to continue."
    >
      <div className="mx-auto w-full max-w-[420px]">
        <form action={formAction} className="flex flex-col gap-[16px]">
          <input type="hidden" name="next" value={callbackTarget} />

          <div>
            <label htmlFor="email" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
              Work email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={pending}
              defaultValue={state.status === 'error' ? state.email ?? '' : ''}
              placeholder="name@company.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              disabled={pending}
              minLength={6}
              placeholder="••••••••"
            />
          </div>

          {errorMessage && (
            <p className="rounded-[12px] border border-[var(--danger)]/40 bg-[var(--tone-danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]">
              {errorMessage}
            </p>
          )}

          <Button
            type="submit"
            fullWidth
            size="md"
            variant={pending ? 'secondary' : 'default'}
            disabled={pending}
          >
            {pending ? 'Signing you in…' : 'Sign in'}
            {!pending && <ArrowRight size={18} />}
          </Button>
        </form>

        <p className="mt-6 text-center text-[13px] text-[var(--ink-mute)]">
          Not an ops user?{' '}
          <Link href="/sign-in" className="text-[var(--brand-purple)] font-semibold">
            Open customer sign-in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
