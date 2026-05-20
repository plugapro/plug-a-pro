import { NewRequestWizard } from '@/components/client/new-request-wizard'
import { getAuthenticatedCustomerContext } from '@/lib/server/client'
import { redirect } from 'next/navigation'

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams?: Promise<{ resume?: string }>
}) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client/new-request')
  const params = (await searchParams) ?? {}
  return <NewRequestWizard resumeId={params.resume} />
}
