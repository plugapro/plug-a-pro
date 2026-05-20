// ─── Provider: Profile / services alias ───────────────────────────────────────
// Blueprint sub-route. Skills/services are managed in the consolidated profile
// page - redirect there so WhatsApp handoffs and deep-links still land correctly.

import { redirect } from 'next/navigation'

export default function ProviderProfileServicesPage() {
  redirect('/provider/profile')
}
