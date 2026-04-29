import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function ProviderJobArrivalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams?: Promise<{ token?: string }>
}) {
  const { jobId } = await params
  const token = (searchParams ? await searchParams : {}).token ?? ''
  redirect(`/provider/jobs/${encodeURIComponent(jobId)}/handover?token=${encodeURIComponent(token)}`)
}
