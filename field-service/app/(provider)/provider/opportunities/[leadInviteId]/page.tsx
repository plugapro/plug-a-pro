// ─── Provider: /provider/opportunities/[leadInviteId] alias ───────────────────
// Blueprint route /provider/opportunities/:leadInviteId maps to
// /provider/leads/[leadId]. Permanent redirect so WhatsApp handoffs that use
// the /opportunities/:id shape continue to land on the correct lead detail page.

import { redirect } from 'next/navigation'

export default async function ProviderOpportunityDetailPage({
  params,
}: {
  params: Promise<{ leadInviteId: string }>
}) {
  const { leadInviteId } = await params
  redirect(`/provider/leads/${encodeURIComponent(leadInviteId)}`)
}
