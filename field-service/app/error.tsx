'use client'

import { useEffect } from 'react'

const WA_NUMBER = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')
const WA_HREF = WA_NUMBER
  ? `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hi, I'm getting an error on Plug A Pro")}`
  : `mailto:support@plugapro.co.za?subject=${encodeURIComponent('Error report')}`

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center overflow-hidden">
      {/* Radial halo — danger tint */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 w-[360px] h-[360px] rounded-full opacity-15"
        style={{ background: '#E5484D', filter: 'blur(80px)' }}
      />

      {/* Layered icon */}
      <div className="relative mb-8">
        {/* Outer danger-soft tile 88×88 */}
        <div
          className="w-[88px] h-[88px] rounded-[28px] flex items-center justify-center"
          style={{ background: 'rgba(229,72,77,0.10)' }}
        >
          {/* Inner danger tile 56×56 */}
          <div
            className="w-[56px] h-[56px] rounded-[18px] flex items-center justify-center"
            style={{
              background: '#E5484D',
              boxShadow: '0 8px 24px rgba(229,72,77,0.35)',
            }}
          >
            <svg
              aria-hidden
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
        </div>
      </div>

      <div className="space-y-3 mb-10 max-w-[320px]">
        <h1
          className="font-bold tracking-[-0.025em]"
          style={{ fontSize: 26, color: 'var(--ink)' }}
        >
          Something went wrong
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-mute)', lineHeight: 1.55 }}>
          An unexpected error occurred. This is usually temporary — try again.
        </p>
        {error.digest && (
          <p
            className="font-mono"
            style={{ fontSize: 11, color: 'var(--ink-soft)' }}
          >
            Error ID: {error.digest}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 w-full max-w-[280px]">
        <button
          onClick={reset}
          className="h-[52px] rounded-[14px] flex items-center justify-center text-[15px] font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)' }}
        >
          Try again
        </button>
        <a
          href={WA_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="h-[52px] rounded-[14px] flex items-center justify-center text-[15px] font-semibold"
          style={{
            background: 'var(--card-alt)',
            color: 'var(--ink)',
            boxShadow: 'inset 0 0 0 1px var(--border)',
          }}
        >
          Get support
        </a>
      </div>
    </div>
  )
}
