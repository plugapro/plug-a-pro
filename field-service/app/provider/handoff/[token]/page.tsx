import { redirect } from 'next/navigation'
import { resolveProviderLeadAccessToken } from '@/lib/provider-lead-access'
import {
  isProviderWhatsappHandoffEvent,
  resolveProviderPwaHandoffPath,
  type ProviderWhatsappHandoffEvent,
} from '@/lib/provider-pwa-handoff'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ProviderHandoffTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ event?: string }>
}) {
  const { token } = await params
  const eventParam = (searchParams ? await searchParams : {}).event
  const event: ProviderWhatsappHandoffEvent = isProviderWhatsappHandoffEvent(eventParam)
    ? eventParam
    : 'new_opportunity'
  const session = await getSession()
  const assertSenderPhone = session?.role === 'provider' && session.phone ? session.phone : undefined
  const resolved = await resolveProviderLeadAccessToken(token, { assertSenderPhone })

  redirect(resolveProviderPwaHandoffPath({
    event,
    token,
    lead: resolved.lead,
  }))
}
