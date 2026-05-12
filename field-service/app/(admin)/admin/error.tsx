'use client'

// Admin-wide error boundary. Catches render/data errors in any /admin/** route.
// AdminErrorPanel handles Sentry capture, console logging, digest display,
// retry, and back-link — no raw error.message is surfaced to the UI.

import { AdminErrorPanel } from '@/components/admin/ui/AdminErrorPanel'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AdminError({ error, reset }: Props) {
  return (
    <AdminErrorPanel
      error={error}
      reset={reset}
      backHref="/admin"
      backLabel="Back to dashboard"
    />
  )
}
