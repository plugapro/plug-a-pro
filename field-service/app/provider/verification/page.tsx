import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Identity Verification', noIndex: true })

export default function ProviderVerificationPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Plug A Pro</p>
        <h1 className="text-2xl font-semibold tracking-normal">Identity Verification</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Verification is required before buying provider credits. The secure verification link is being prepared for
          your profile.
        </p>
      </div>

      <section className="space-y-3 rounded-lg border bg-card p-4 text-sm leading-6">
        <p>
          If you came here from WhatsApp, return to the chat and reply <span className="font-semibold">VERIFY</span>.
          Plug A Pro will guide you through the next identity step without showing your ID, passport, or permit number in
          WhatsApp messages.
        </p>
        <p className="text-muted-foreground">
          If you were trying to buy credits, complete the high-assurance verification step first. Promotional or starter
          credits remain available according to the provider credits rules.
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/provider/terms/credits"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          View credit rules
        </Link>
        <Link
          href="/provider-sign-in"
          className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm font-medium"
        >
          Worker Portal sign-in
        </Link>
      </div>
    </main>
  )
}
