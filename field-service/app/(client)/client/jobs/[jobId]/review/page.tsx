import { JobReviewScreen } from '@/components/client/job-review-screen'

export default async function ClientJobReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  return <JobReviewScreen jobId={jobId} />
}
