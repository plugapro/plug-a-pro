// ─── Provider flyer short URL: /join ─────────────────────────────────────────
// Printed materials need a short, memorable URL. Keep the destination canonical
// so provider authentication and onboarding recovery remain in one place.

import { permanentRedirect } from 'next/navigation'

export default function ProviderFlyerJoinPage() {
  permanentRedirect('/provider-sign-in')
}
