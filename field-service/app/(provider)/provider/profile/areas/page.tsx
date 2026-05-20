// ─── Provider: Profile / areas alias ──────────────────────────────────────────
// Blueprint sub-route. Service areas are managed in the consolidated profile
// page - redirect there so WhatsApp handoffs and deep-links still land correctly.

import { redirect } from 'next/navigation'

export default function ProviderProfileAreasPage() {
  redirect('/provider/profile')
}
