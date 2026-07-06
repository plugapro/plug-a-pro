import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Application submitted',
  robots: { index: false, follow: false },
}

export default function Confirmation() {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-2xl font-semibold">Application submitted</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {"We'll WhatsApp you within 30 minutes once an admin reviews it."}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        {"We're live in the West Rand first — if your area isn't live yet, we'll notify you the moment leads open there."}
      </p>
    </main>
  )
}
