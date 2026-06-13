'use client'

// ComingSoonTile — replaces the dead "unavailable category" tile on the customer
// home grid (behind customer.home.notify_interest). Instead of a greyed dead end,
// the tile invites the customer to register interest: tapping it opens a bottom
// sheet that captures a WhatsApp number and POSTs to /api/customer/notify-interest,
// recording demand on the service-area waitlist. Once submitted, the tile remembers
// (per area + category) and shows an "On the list" state.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Droplets, Hammer, Paintbrush, Sparkles, Wrench,
  Tv2, Grid3x3, Layers, PaintRoller, Leaf, Drill,
  Bell, Check, Loader2, type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  plumbing: Droplets,
  appliances: Tv2,
  handyman: Hammer,
  carpentry: Wrench,
  painting: Paintbrush,
  cleaning: Sparkles,
  garden: Leaf,
  diy: Drill,
  tiling: Grid3x3,
  plastering: Layers,
  rhinoliting: PaintRoller,
}

function storageKey(areaSlug: string, tag: string) {
  return `pap-notify:${areaSlug}:${tag}`
}

function readQueued(areaSlug: string, tag: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(storageKey(areaSlug, tag)) === '1'
  } catch {
    return false
  }
}

export function ComingSoonTile({
  tag,
  label,
  hue,
  areaSlug,
  areaLabel,
}: {
  tag: string
  label: string
  hue: string
  areaSlug: string
  areaLabel: string
}) {
  const Icon = ICONS[tag] ?? Wrench
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(() => readQueued(areaSlug, tag))

  function closeSheet() {
    setOpen(false)
    setError(null)
    if (status !== 'done') setStatus('idle')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'submitting') return
    setStatus('submitting')
    setError(null)
    try {
      const res = await fetch('/api/customer/notify-interest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, category: tag, area: areaSlug }),
      })
      if (!res.ok) {
        const msg =
          res.status === 429
            ? 'Too many requests — please wait a moment and try again.'
            : res.status === 422
              ? 'Please enter a valid South African mobile number.'
              : 'Something went wrong. Please try again.'
        setError(msg)
        setStatus('idle')
        return
      }
      try {
        window.localStorage.setItem(storageKey(areaSlug, tag), '1')
      } catch {}
      setQueued(true)
      setStatus('done')
    } catch {
      setError('Network error. Please check your connection and try again.')
      setStatus('idle')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label} — coming soon to ${areaLabel}. Tap to get notified.`}
        className="relative flex flex-col items-center gap-2 pt-[14px] pb-[10px] px-1.5 rounded-[16px] transition-[transform] duration-150 active:scale-[0.97]"
        style={{
          background: 'var(--card)',
          boxShadow: queued ? 'inset 0 0 0 1px color-mix(in srgb, var(--brand-purple) 45%, transparent)' : 'inset 0 0 0 1px var(--border)',
        }}
      >
        <span
          className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 h-[17px] px-1.5 rounded-full text-[8.5px] font-bold uppercase tracking-[0.04em]"
          style={
            queued
              ? { background: 'var(--brand-gradient)', color: '#fff' }
              : { background: 'rgba(255,255,255,0.06)', color: 'var(--ink-soft)', boxShadow: 'inset 0 0 0 1px var(--border)' }
          }
        >
          {queued ? <Check size={9} /> : <Bell size={9} />}
          {queued ? 'On list' : 'Soon'}
        </span>
        <span
          className="flex items-center justify-center w-9 h-9 rounded-[11px]"
          style={
            queued
              ? { background: `${hue}1f`, color: hue }
              : { background: 'rgba(255,255,255,0.05)', color: 'var(--ink-soft)' }
          }
          aria-hidden
        >
          <Icon size={20} aria-hidden />
        </span>
        <span className="text-[11.5px] font-semibold text-center leading-tight tracking-[-0.01em]" style={{ color: 'var(--ink-mute)' }}>
          {label}
        </span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={closeSheet}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label={`Get notified about ${label} in ${areaLabel}`}
            className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-[430px] flex flex-col rounded-t-[28px] px-5 pt-3"
            style={{
              background: 'var(--card)',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
              paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
            }}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--border)' }} aria-hidden />

            {status === 'done' ? (
              <div className="text-center pb-2">
                <div
                  className="w-[68px] h-[68px] rounded-full mx-auto mb-4 flex items-center justify-center brand-gradient"
                  style={{ boxShadow: '0 12px 32px color-mix(in srgb, var(--brand-purple) 40%, transparent)' }}
                >
                  <Check size={32} color="#fff" strokeWidth={2.6} />
                </div>
                <h2 className="text-[19px] font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
                  You&rsquo;re on the list
                </h2>
                <p className="mt-2 mx-auto max-w-[300px] text-[13.5px] leading-[1.5]" style={{ color: 'var(--ink-mute)' }}>
                  We&rsquo;ll send one WhatsApp the moment a vetted <b style={{ color: 'var(--ink)' }}>{label}</b> pro
                  covers <b style={{ color: 'var(--ink)' }}>{areaLabel}</b>. Your interest also helps us recruit one faster.
                </p>
                <button
                  type="button"
                  onClick={closeSheet}
                  className="mt-5 w-full h-[52px] rounded-[15px] brand-gradient text-white text-[15px] font-bold press-feedback"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <span
                  className="flex items-center justify-center w-[52px] h-[52px] rounded-[15px] mb-3"
                  style={{ background: `${hue}1f`, color: hue }}
                  aria-hidden
                >
                  <Icon size={26} />
                </span>
                <h2 className="text-[19px] font-bold tracking-[-0.02em] leading-[1.2]" style={{ color: 'var(--ink)' }}>
                  {label} is coming to {areaLabel}
                </h2>
                <p className="mt-2 text-[13.5px] leading-[1.5]" style={{ color: 'var(--ink-mute)' }}>
                  We don&rsquo;t have a vetted {label.toLowerCase()} pro covering {areaLabel} just yet. Leave your number
                  and we&rsquo;ll WhatsApp you the minute one goes live.
                </p>

                <label className="block mt-4 mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.06em] px-0.5" style={{ color: 'var(--ink-soft)' }}>
                  Your WhatsApp number
                </label>
                <div
                  className="flex items-center gap-2 h-[50px] rounded-[14px] px-3.5"
                  style={{ background: 'var(--background)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
                >
                  <span className="text-[15px] font-bold" style={{ color: 'var(--ink-mute)' }}>+27</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="82 123 4567"
                    aria-label="WhatsApp number"
                    className="flex-1 min-w-0 bg-transparent border-none outline-none text-[16px] font-semibold"
                    style={{ color: 'var(--ink)' }}
                  />
                </div>

                {error && (
                  <p className="mt-2.5 text-[12.5px] leading-snug" style={{ color: 'var(--brand-pink)' }}>{error}</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'submitting' || phone.trim().length < 6}
                  className="mt-4 w-full h-[52px] rounded-[15px] brand-gradient text-white text-[15px] font-bold flex items-center justify-center gap-2 press-feedback disabled:opacity-50"
                >
                  {status === 'submitting'
                    ? <Loader2 size={18} className="animate-spin" />
                    : <Bell size={18} />}
                  {status === 'submitting' ? 'Adding you…' : 'Notify me when it’s live'}
                </button>
                <button
                  type="button"
                  onClick={closeSheet}
                  className="mt-1.5 w-full h-9 text-[13px] font-semibold"
                  style={{ color: 'var(--ink-soft)' }}
                >
                  Not now
                </button>
              </form>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
