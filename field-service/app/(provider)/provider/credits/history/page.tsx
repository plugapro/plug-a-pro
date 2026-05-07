// ─── Provider: Credits history alias ──────────────────────────────────────────
// /provider/credits/history redirects to /provider/credits which already renders
// the full ledger. Keeping both URLs so WhatsApp deep-links and future copy
// can use the more descriptive path.

import { redirect } from 'next/navigation'

export default function ProviderCreditsHistoryPage() {
  redirect('/provider/credits')
}
