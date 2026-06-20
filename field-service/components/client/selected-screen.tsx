import Link from 'next/link'
import { WhatsAppLink } from '@/components/shared/WhatsAppLink'

export function SelectedScreen() {
  return (
    <div className="mx-auto max-w-md px-5 py-10 text-center">
      <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-[var(--tone-brand-bg)]" />
      <p className="text-xl font-bold tracking-tight">Awaiting provider confirmation</p>
      <p className="mt-2 text-sm text-[var(--ink-mute)]">We&apos;ll notify you on WhatsApp as soon as they respond.</p>
      <div className="mt-5 space-y-2">
        <Link href="/client/requests" className="block rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold">
          Choose another provider
        </Link>
        <Link href="/client" className="block rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold">
          Cancel request
        </Link>
        <WhatsAppLink
          href="https://wa.me/"
          source="selected_screen_support"
          ctaLabel="Contact support"
          className="block rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold"
        >
          Contact support
        </WhatsAppLink>
      </div>
    </div>
  )
}
