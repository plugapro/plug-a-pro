import { redirect } from 'next/navigation'
import { getAuthenticatedCustomerContext } from '@/lib/server/client'
import { SelectedScreen } from '@/components/client/selected-screen'

export const dynamic = 'force-dynamic'

export default async function RequestSelectedPage() {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client')
  return <SelectedScreen />
}
