// Completion confirmation — public, tokenized, no login required.
// Provider marks job PENDING_COMPLETION_CONFIRMATION → customer receives a
// WhatsApp link here → taps → confirms job is done → job transitions to COMPLETED.

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { verifyJobCompletionToken } from '@/lib/job-completion-access'
import { db } from '@/lib/db'
import { transitionJob } from '@/lib/jobs'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const metadata = buildMetadata({
  title: 'Confirm Job Completion',
  noIndex: true,
})

interface Props {
  params: Promise<{ token: string }>
}

export default async function ConfirmCompletionPage({ params }: Props) {
  const { token: rawToken } = await params
  const token = decodeURIComponent(rawToken)

  const verified = verifyJobCompletionToken(token)

  if (verified.status === 'expired') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <Card className="w-full max-w-sm shadow-sm">
          <CardContent className="px-6 py-6 text-center space-y-2">
            <p className="text-2xl mb-2">⏰</p>
            <h1 className="text-lg font-semibold">Link Expired</h1>
            <p className="text-sm text-muted-foreground">
              This confirmation link has expired. Please open the app or contact support
              to confirm your job completion.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (verified.status !== 'active') {
    notFound()
  }

  const { jobId, customerId } = verified.payload

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: { include: { customer: true } },
            },
          },
        },
      },
    },
  })

  if (!job || job.booking?.match?.jobRequest?.customer?.id !== customerId) {
    notFound()
  }

  const category = job.booking?.match?.jobRequest?.category ?? 'job'

  if (job.status === 'COMPLETED') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <Card className="w-full max-w-sm shadow-sm">
          <CardContent className="px-6 py-6 text-center space-y-2">
            <p className="text-2xl mb-2">✓</p>
            <h1 className="text-lg font-semibold">Job Confirmed</h1>
            <p className="text-sm text-muted-foreground">
              Your {category} job has already been confirmed as complete.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (job.status !== 'PENDING_COMPLETION_CONFIRMATION') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <Card className="w-full max-w-sm shadow-sm">
          <CardContent className="px-6 py-6 text-center space-y-2">
            <p className="text-2xl mb-2">⚠️</p>
            <h1 className="text-lg font-semibold">Not Ready for Sign-Off</h1>
            <p className="text-sm text-muted-foreground">
              This job is not yet ready for completion confirmation. Please check back
              once the provider has finished the work.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function handleConfirm() {
    'use server'
    await transitionJob({
      jobId,
      toStatus: 'COMPLETED',
      actorId: customerId,
      actorRole: 'customer',
      notes: 'Customer confirmed via completion link',
    })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm shadow-sm">
        <CardContent className="px-6 py-6 space-y-4">
          <div className="text-center space-y-1">
            <p className="text-3xl mb-2">🔧</p>
            <h1 className="text-lg font-semibold">Confirm Job Complete</h1>
            <p className="text-sm text-muted-foreground">
              Your <span className="font-medium">{category}</span> job has been marked
              ready for sign-off. Tap below to confirm it&apos;s done.
            </p>
          </div>
          <form action={handleConfirm}>
            <Button type="submit" className="w-full" size="lg">
              Confirm Completion
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
