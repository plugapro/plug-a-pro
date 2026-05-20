import { redirect } from 'next/navigation'
import { JobReviewScreen } from '@/components/client/job-review-screen'
import { getAuthenticatedCustomerContext, getJobForClient } from '@/lib/server/client'

export default async function ClientJobReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client')

  const { jobId } = await params
  const job = await getJobForClient(jobId, auth.customer.id)
  if (!job) redirect('/client')
  if (job.status !== 'COMPLETED') redirect(`/client/jobs/${job.id}`)
  return <JobReviewScreen jobId={jobId} />
}
