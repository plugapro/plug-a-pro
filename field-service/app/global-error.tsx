'use client'

// ─── Root-layout error boundary (audit OBS-02) ────────────────────────────────
// Rendered only when the root layout itself crashes, replacing the entire
// document - so globals.css (and its CSS variables) are NOT available here.
// Keep it minimal, brand-neutral and dependency-free; the priority is that the
// crash reaches Sentry and the user gets a recoverable screen instead of the
// browser default.

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
          textAlign: 'center',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: '#ffffff',
          color: '#1a1a2e',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            background: '#E5484D',
            boxShadow: '0 8px 24px rgba(229,72,77,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 28,
          }}
        >
          <svg
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

        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '0 0 12px' }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: '#5c5f6e', maxWidth: 320, margin: '0 0 8px' }}>
          An unexpected error occurred. This is usually temporary - try again.
        </p>
        {error.digest && (
          <p style={{ fontSize: 11, fontFamily: 'monospace', color: '#8a8d9c', margin: '0 0 32px' }}>
            Error ID: {error.digest}
          </p>
        )}

        <button
          onClick={reset}
          style={{
            height: 52,
            width: '100%',
            maxWidth: 280,
            borderRadius: 14,
            border: 'none',
            cursor: 'pointer',
            fontSize: 15,
            fontWeight: 600,
            color: '#ffffff',
            background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)',
            marginTop: error.digest ? 0 : 24,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
