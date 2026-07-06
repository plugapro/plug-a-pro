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
        {"We'll WhatsApp you once your application has been reviewed - most reviews happen within one business day. Approval is not automatic."}
      </p>
    </main>
  )
}
