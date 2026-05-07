// ─── Provider: /provider/apply alias ──────────────────────────────────────────
// Blueprint route /provider/apply maps to /provider/application.
// Permanent redirect so WhatsApp handoffs and marketing copy using /apply
// continue to land on the current application status screen.

import { redirect } from 'next/navigation'

export default function ProviderApplyPage() {
  redirect('/provider/application')
}
