// ─── Provider: Profile / rates alias ──────────────────────────────────────────
// Blueprint sub-route. Rates are surfaced on the main profile page.
// Redirect so WhatsApp handoff deep-links still land at the right screen.

import { redirect } from 'next/navigation'

export default function ProviderProfileRatesPage() {
  redirect('/provider/profile')
}
