// ─── Provider: Profile / availability alias ───────────────────────────────────
// Blueprint sub-route. Availability has a dedicated page at /provider/availability.
// Redirect so both paths work — useful for WhatsApp copy and future navigation links.

import { redirect } from 'next/navigation'

export default function ProviderProfileAvailabilityPage() {
  redirect('/provider/availability')
}
