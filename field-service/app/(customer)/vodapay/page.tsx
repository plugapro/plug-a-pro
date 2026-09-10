// /vodapay — VodaPay mini-program entry route.
//
// Flag-gated by channel.vodapay.v1 (404 while OFF, so nothing changes for
// web/WhatsApp customers). Renders the bootstrap client component, which
// loads the hylid-bridge script, detects whether we're really running
// inside the VodaPay WebView, marks the request as VodaPay-channel via
// POST /api/channel, and hands off to the normal customer home — VodaPay
// mode is then carried by the pap_channel cookie (see lib/channel.ts).
import { notFound } from 'next/navigation'
import { isEnabled } from '@/lib/flags'
import { VodapayBootstrap } from '@/components/customer/VodapayBootstrap'

export const dynamic = 'force-dynamic'

export default async function VodapayEntryPage() {
  if (!(await isEnabled('channel.vodapay.v1'))) notFound()
  return <VodapayBootstrap />
}
