'use client'
// ─── BreachBanner ─────────────────────────────────────────────────────────────
// Persistent top-of-page banner when SLA-breached cases exist.
// Session-dismissable only — dismissal does not persist on reload.

import { useState } from 'react'
import Link from 'next/link'

export function BreachBanner({ count }: { count: number }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || count === 0) return null

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
      <span>
        ⚠️ <strong>{count} {count === 1 ? 'case' : 'cases'} past SLA</strong>
        {' — '}
        <Link href="/admin/breached" className="underline underline-offset-2 hover:opacity-80">
          View breached cases
        </Link>
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
        aria-label="Dismiss breach banner"
      >
        ✕
      </button>
    </div>
  )
}
