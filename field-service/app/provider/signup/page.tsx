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

  const rawCaptured = (conv.data as Record<string, unknown>) ?? {}

  // SECURITY (finding 4e38133b): the resume link is an anonymous bearer token, so
  // anything passed to client components is serialized into the browser/RSC
  // payload and visible to anyone who obtains the (leaked/forwarded/logged) URL.
  // The full Conversation.data can contain raw ID numbers, identity-verification
  // IDs, document/media attachment IDs, alternate phone numbers and internal
  // workflow state. We therefore build a NARROW, allowlisted snapshot containing
  // only the fields CapturedPanel and the section selector actually need, and we
  // derive minimal/masked values for the sensitive ones (masked ID, boolean-style
  // sentinels for verification attachments) instead of forwarding raw secrets.
  const capturedData = buildClientCapturedData(rawCaptured)

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

// Allowlisted projection of Conversation.data for client components. Only the
// keys read by CapturedPanel and lib/web-signup-sections#selectMissingSections
// are included; sensitive raw values are masked or reduced to presence sentinels.
function buildClientCapturedData(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  const copyString = (key: string) => {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) out[key] = v
  }
  const copyStringArray = (key: string) => {
    const v = raw[key]
    if (Array.isArray(v) && v.length > 0) out[key] = v.filter((item) => typeof item === 'string')
  }

  // Plain display / form-selection fields (no special sensitivity beyond being
  // the provider's own captured signup data).
  copyString('name')
  copyStringArray('skills')
  copyString('regionLabel')
  copyString('cityLabel')
  copyStringArray('availability')
  copyString('bio')
  copyString('references')
  copyString('profilePhotoUrl')
  copyStringArray('evidenceFileUrls')

  const hourlyRate = raw.hourlyRate
  if (typeof hourlyRate === 'number') out.hourlyRate = hourlyRate

  // ID number: WhatsApp may store it under `providerIdNumber`. CapturedPanel only
  // ever renders the last 4 digits, and the section selector only needs to know
  // it was captured. Forward a masked value so the raw 13-digit SA ID never
  // reaches the browser.
  const rawId =
    (typeof raw.idNumber === 'string' && raw.idNumber.trim() && raw.idNumber) ||
    (typeof raw.providerIdNumber === 'string' && raw.providerIdNumber.trim() && raw.providerIdNumber) ||
    ''
  if (rawId) {
    const digits = rawId.replace(/\D/g, '')
    out.idNumber = `•••••••••${digits.slice(-4)}`
  }

  // Verification attachments are referenced only as a "was it captured?" signal by
  // selectMissingSections. Replace the raw media/attachment IDs with sentinels so
  // the internal IDs never leak, while preserving the skip-identity behaviour.
  if (raw.verificationMethod === 'skipped') out.verificationMethod = 'skipped'
  if (typeof raw.verificationDocAttachmentId === 'string' && raw.verificationDocAttachmentId.trim()) {
    out.verificationDocAttachmentId = 'captured'
  }
  if (typeof raw.verificationSelfieAttachmentId === 'string' && raw.verificationSelfieAttachmentId.trim()) {
    out.verificationSelfieAttachmentId = 'captured'
  }

  return out
}
