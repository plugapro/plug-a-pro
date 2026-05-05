import { redirect } from 'next/navigation'
import { resolveProviderLeadAccessToken } from '@/lib/provider-lead-access'
import { resolveProviderPwaHandoffPath, type ProviderWhatsappHandoffEvent } from '@/lib/provider-pwa-handoff'

export const dynamic = 'force-dynamic'

export default async function ProviderHandoffTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ event?: ProviderWhatsappHandoffEvent }>
}) {
  const { token } = await params
  const event = (searchParams ? await searchParams : {}).event ?? 'new_opportunity'
  const resolved = await resolveProviderLeadAccessToken(token)

  redirect(resolveProviderPwaHandoffPath({
    event,
    token,
    lead: resolved.lead,
  }))
}
