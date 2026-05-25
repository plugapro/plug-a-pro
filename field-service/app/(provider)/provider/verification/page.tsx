import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Identity Verification', noIndex: true })

// Placeholder — the full PWA verification flow (app/(provider)/provider/verify/[token])
// ships in Phase 1b. This page ensures the WhatsApp CTA deep link (/provider/verification)
// is not a 404 in the interim.
export default async function ProviderVerificationPage() {
  await requireProvider()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Identity Verification</h1>
      <p className="max-w-sm text-muted-foreground">
        Identity verification is coming soon. Our team will contact you via WhatsApp when it is
        available.
      </p>
      <p className="text-sm text-muted-foreground">
        If you received a link to verify your identity, please check your WhatsApp messages for
        further instructions.
      </p>
    </div>
  )
}
