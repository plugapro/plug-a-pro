// ─── Provider: Opportunities alias ────────────────────────────────────────────
// Blueprint route /provider/opportunities maps to /provider/leads.
// Permanent redirect keeps both URLs working (WhatsApp handoffs use /leads,
// future copy may use /opportunities).

import { redirect } from 'next/navigation'

export default function ProviderOpportunitiesPage() {
  redirect('/provider/leads')
}
