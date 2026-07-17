'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

// Catches errors thrown in the root layout itself (where the normal error.tsx
// boundary cannot render). This replaces the entire document, so it must supply
// its own <html>/<body>. Kept intentionally minimal — its only job is to report
// the failure and let the user retry.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0, background: '#0A0A0F', color: '#fff', textAlign: 'center', padding: '24px' }}>
        <div style={{ maxWidth: 320 }}>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ fontSize: 15, opacity: 0.7, lineHeight: 1.5, marginBottom: 24 }}>
            An unexpected error occurred. This is usually temporary — please try again.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace', marginBottom: 24 }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{ height: 52, width: '100%', borderRadius: 14, border: 'none', color: '#fff', fontSize: 15, fontWeight: 600, background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
