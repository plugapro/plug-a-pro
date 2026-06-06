// /provider/signup — anonymous, token-gated provider web finish page.
// No Supabase session required; the ProviderResumeToken IS the auth.
// Behind: whatsapp.registration.web_resume flag.

import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { validateProviderResumeToken } from '@/lib/provider-resume-tokens'
import { CapturedPanel } from './captured-panel'
import { RemainingFieldsForm } from './remaining-fields-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Finish your signup',
  robots: { index: false, follow: false },
}

// ─── Error panel ─────────────────────────────────────────────────────────────

function ErrorPanel({ reason }: { reason: string }) {
  const message =
    reason === 'expired'
      ? 'This link has expired. Please reply on WhatsApp to get a new one.'
      : reason === 'used'
        ? 'This link has already been used.'
        : reason === 'revoked'
          ? 'This link has been revoked. Please reply on WhatsApp.'
          : reason === 'missing_token'
            ? 'No resume token provided.'
            : 'We could not find this signup link. Please reply on WhatsApp.'
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">Resume link unavailable</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </main>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ProviderSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>
}) {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">Not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This feature is not currently enabled.
        </p>
      </main>
    )
  }

  const rawToken = (await searchParams).t
  if (!rawToken) return <ErrorPanel reason="missing_token" />

  const validated = await validateProviderResumeToken(db, rawToken)
  if (!validated.ok) return <ErrorPanel reason={validated.reason} />

  const conv = await db.conversation.findUnique({ where: { id: validated.conversationId } })
  if (!conv) return <ErrorPanel reason="not_found" />

  const capturedData = (conv.data as Record<string, unknown>) ?? {}
  // Backfill canonical key from WhatsApp's variant before computing sections
  if (!capturedData.idNumber && typeof capturedData.providerIdNumber === 'string') {
    capturedData.idNumber = capturedData.providerIdNumber
  }

  return (
    <main className="mx-auto max-w-md p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Finish your provider signup</h1>
        <p className="text-sm text-muted-foreground">
          We picked up where you left off on WhatsApp.
        </p>
      </header>
      <CapturedPanel data={capturedData} />
      <RemainingFieldsForm
        rawToken={rawToken}
        conversationId={conv.id}
        phone={conv.phone}
        capturedData={capturedData}
      />
    </main>
  )
}
