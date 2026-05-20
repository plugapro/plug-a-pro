import { redirect } from 'next/navigation'
import { getAuthenticatedCustomerContext, getJobForClient } from '@/lib/server/client'
import { JobLiveScreen } from '@/components/client/job-live-screen'

export default async function ClientJobStatusPage({ params }: { params: Promise<{ jobId: string }> }) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client')

  const { jobId } = await params
  const job = await getJobForClient(jobId, auth.customer.id)
  if (!job) redirect('/client')
  if (job.status === 'COMPLETED') redirect(`/client/jobs/${job.id}`)
  if (job.status === 'FAILED' || job.status === 'CANCELLED') redirect('/client')

  return (
    <JobLiveScreen
      jobId={job.id}
      initialStatus={{
        status: job.status,
        etaMins: job.status === 'EN_ROUTE' ? 14 : null,
        extras: job.extras.map((extra) => ({
          id: extra.id,
          description: extra.description,
          amount: Number(extra.amount),
          status: extra.status,
        })),
      }}
    />
  )
}
