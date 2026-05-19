import { notFound, redirect } from 'next/navigation'
import { resolveReviewAccessToken } from '@/lib/review-access'
import ReviewForm from './ReviewForm'
export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ token: string }> }
export default async function ReviewPage({ params }: Props) {
  const { token } = await params
  const decoded = decodeURIComponent(token)
  const resolved = await resolveReviewAccessToken(decoded)
  if (resolved.status !== 'active' || !resolved.context) notFound()
  const { context } = resolved
  if (context.existingReview) redirect(`/review/${token}/thanks`)
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Leave a review</h1>
          <p className="text-sm text-muted-foreground">
            {context.reviewerType === 'CUSTOMER'
              ? `How was your experience with ${context.provider.name}?`
              : `How was the job with ${context.customer.name}?`}
          </p>
        </div>
        <ReviewForm matchId={context.matchId} reviewerType={context.reviewerType} token={decoded}
          subjectName={context.reviewerType === 'CUSTOMER' ? context.provider.name : context.customer.name}
          jobCategory={context.jobCategory} />
      </div>
    </main>
  )
}
