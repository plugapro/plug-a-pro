import { NewRequestWizard } from '@/components/client/new-request-wizard'

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams?: Promise<{ resume?: string }>
}) {
  const params = (await searchParams) ?? {}
  return <NewRequestWizard resumeId={params.resume} />
}

