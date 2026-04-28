export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

export default async function LeadIdRedirectPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { leadId } = await params
  const session = await getSession()

  if (session?.role === 'provider') {
    redirect(`/provider/leads/${leadId}`)
  }

  redirect(`/provider-sign-in?next=${encodeURIComponent(`/provider/leads/${leadId}`)}`)
}
