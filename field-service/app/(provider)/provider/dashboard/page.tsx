// ─── Provider: /provider/dashboard alias ──────────────────────────────────────
// Blueprint route /provider/dashboard maps to /provider (the dashboard page).
// Permanent redirect so WhatsApp handoffs and legacy links using /dashboard
// continue to land on the provider home screen.

import { redirect } from 'next/navigation'

export default function ProviderDashboardPage() {
  redirect('/provider')
}
