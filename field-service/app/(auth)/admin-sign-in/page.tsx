'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { ArrowRight, Eye, EyeOff, Lock, Mail, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthShell } from '@/components/shared/auth-shell'
import { getSafeAdminNextPath } from '@/lib/safe-redirect'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export default function AdminSignInPage() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError || !data.user) {
        setError('Invalid email or password.')
        return
      }

      if (data.session?.access_token) {
        const sessionRes = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: data.session.access_token,
            expiresIn: data.session.expires_in ?? 3600,
          }),
        })
        if (!sessionRes.ok) {
          setError('Failed to establish session. Please try again.')
          return
        }

        const sessionData = (await sessionRes.json()) as { adminAccess?: boolean }

        if (!sessionData.adminAccess) {
          await supabase.auth.signOut()
          await fetch('/api/auth/session', { method: 'DELETE' })
          setError('Your account does not have admin access.')
          return
        }
      }

      // Hard navigation so the browser sends the newly-set HttpOnly cookie
      // with the initial request to /admin (soft router.replace fires before
      // the Set-Cookie header is committed by the browser).
      window.location.assign(next)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      backHref="/sign-in"
      eyebrow="Internal · Admin portal"
      title="Team access"
      subtitle="For Plug A Pro staff only. SSO and 2FA are enforced."
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label
            htmlFor="email"
            className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]"
          >
            Work email
          </label>
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--ink-mute)', pointerEvents: 'none',
            }}>
              <Mail size={16} />
            </div>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@plugapro.co.za"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null) }}
              required
              disabled={loading}
              className="pl-10"
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <label
              htmlFor="password"
              className="text-[13px] font-semibold text-[var(--ink)] tracking-[-0.01em]"
            >
              Password
            </label>
            <button
              type="button"
              onClick={() => alert('Password reset — contact your Plug A Pro administrator.')}
              className="text-[12px] font-semibold text-[var(--brand-purple)] outline-none focus-visible:underline"
            >
              Forgot?
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--ink-mute)', pointerEvents: 'none',
            }}>
              <Lock size={16} />
            </div>
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null) }}
              required
              disabled={loading}
              className="pl-10 pr-12"
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((s) => !s)}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--ink-mute)', display: 'flex', padding: 4,
              }}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-[13px] text-[var(--danger)] text-center">{error}</p>
        )}

        <Button
          type="submit"
          fullWidth
          variant={isValid && !loading ? 'default' : 'secondary'}
          disabled={!isValid || loading}
          size="md"
        >
          {loading ? 'Signing in…' : 'Sign in'}
          {!loading && <ArrowRight size={18} />}
        </Button>

        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 12,
          background: 'var(--card-alt, #F4F4F7)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Shield size={16} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
          <span className="text-[12px] text-[var(--ink-mute)] leading-snug">
            All actions are logged and audited. Unauthorized access is prohibited.
          </span>
        </div>
      </form>
    </AuthShell>
  )
}
