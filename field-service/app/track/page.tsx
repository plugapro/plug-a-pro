'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/components/shared/app-logo'
import { Wordmark } from '@/components/shared/wordmark'

export default function TrackPage() {
  const router = useRouter()
  const [ref, setRef] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const normalized = ref.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const isValid = normalized.length >= 6

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`/api/track?ref=${encodeURIComponent(normalized)}`)
      if (res.status === 404) {
        setError('No request found with that reference. Check the number and try again.')
        return
      }
      if (!res.ok) {
        setError('Could not look up your request right now. Please try again.')
        return
      }
      const data = await res.json()
      if (data.token) {
        router.push(`/requests/access/${encodeURIComponent(data.token)}`)
      } else if (data.bookingId) {
        router.push(`/bookings/${data.bookingId}`)
      } else {
        setError('No request found with that reference. Check the number and try again.')
      }
    } catch {
      setError('Could not look up your request right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex flex-col min-h-dvh bg-background overflow-x-hidden">
      {/* Gradient halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -left-20 -right-20 h-80"
        style={{ background: 'radial-gradient(60% 80% at 50% 0%, rgba(139,63,232,0.15), transparent 70%)' }}
      />

      <div className="h-[max(env(safe-area-inset-top,0px),20px)] shrink-0" />

      <header className="relative z-10 flex items-center justify-between px-4 py-2">
        <div className="w-[38px]" aria-hidden />
        <div className="flex items-center gap-2">
          <AppLogo href="/" compact className="h-[26px]" priority />
          <Wordmark size={12} />
        </div>
        <div className="w-[38px]" aria-hidden />
      </header>

      <div className="flex-1 relative z-[1] px-[22px] pt-8 pb-8">
        <p className="text-[11px] font-bold tracking-[0.085em] uppercase text-[var(--brand-purple)] text-center mb-2">
          Track a request
        </p>
        <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-[var(--ink)] text-center mb-2 [text-wrap:balance]">
          Find your job
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--ink-mute)] text-center mb-8 [text-wrap:pretty]">
          Enter the 8-character reference from your confirmation message.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="ref" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
              Reference number
            </label>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--ink-mute)' }}
              />
              <input
                id="ref"
                type="text"
                value={ref}
                onChange={(e) => { setRef(e.target.value); setError(null) }}
                placeholder="e.g. A1B2C3D4"
                maxLength={12}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="w-full h-12 pl-9 pr-4 rounded-[14px] border text-[15px] font-mono font-medium tracking-[0.04em] uppercase outline-none bg-[var(--card)] border-[var(--border)] placeholder:text-[var(--ink-soft)] focus:border-[var(--brand-purple)] transition-colors"
                style={{ color: 'var(--ink)' }}
              />
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink-mute)]">
              Found in your WhatsApp confirmation or booking email.
            </p>
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
            {loading ? 'Looking up…' : 'Track request'}
            {!loading && <ArrowRight size={18} />}
          </Button>
        </form>

        <div className="flex items-center gap-2.5 my-7">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-[11px] text-[var(--ink-soft)] uppercase tracking-[0.06em]">or</span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        <div className="flex flex-col gap-2.5">
          <Button variant="secondary" fullWidth size="md" asChild>
            <Link href="/sign-in?next=/bookings">Sign in to see all bookings</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
