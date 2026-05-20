import { redirect } from 'next/navigation'
import { getJobForClient } from '@/lib/server/client'
import { JobLiveScreen } from '@/components/client/job-live-screen'

export default async function ClientJobStatusPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const job = await getJobForClient(jobId)
  if (!job) redirect('/client')
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

