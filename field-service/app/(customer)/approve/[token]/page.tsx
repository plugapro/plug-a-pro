// Extra work approval — public, tokenized, no login required
// Customer receives a WhatsApp link → taps → approves/declines extra work

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { resolveExtraWork } from '@/lib/jobs'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent } from '@/components/ui/card'
import { ApprovalCard } from '@/components/customer/ApprovalCard'

export const metadata = buildMetadata({
  title: 'Approve Additional Work',
  noIndex: true,
})

interface Props {
  params: Promise<{ token: string }>
  searchParams: Promise<{ action?: string }>
}

export default async function ApprovalPage({ params, searchParams }: Props) {
  const { token } = await params
  const { action } = await searchParams

  const extra = await db.extraWork.findUnique({
    where: { approvalToken: token },
    include: {
      job: {
        include: {
          booking: {
            include: {
              match: {
                include: {
                  jobRequest: {
                    include: { customer: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!extra) notFound()

  // Token expired — show neutral message so customer can contact support
  if (extra.expiresAt && extra.expiresAt < new Date() && extra.status === 'PENDING') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <Card className="w-full max-w-sm shadow-sm">
          <CardContent className="px-6 py-6 text-center space-y-1">
            <p className="text-2xl mb-2">⏰</p>
            <h1 className="text-lg font-semibold">Approval link expired</h1>
            <p className="text-sm text-muted-foreground">
              This approval link has expired. Please contact your provider to request a new one.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Already resolved
  if (extra.status !== 'PENDING') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <Card className="w-full max-w-sm shadow-sm">
          <CardContent className="px-6 py-6 text-center space-y-1">
            <p className="text-2xl mb-2">
              {extra.status === 'APPROVED' ? '✓' : '✗'}
            </p>
            <h1 className="text-lg font-semibold">
              {extra.status === 'APPROVED' ? 'Work Approved' : 'Work Declined'}
            </h1>
            <p className="text-sm text-muted-foreground">
              This request has already been{' '}
              {extra.status === 'APPROVED' ? 'approved' : 'declined'}.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Handle form submission (Server Action)
  async function handleApproval(formData: FormData) {
    'use server'
    const approved = formData.get('action') === 'approve'
    await resolveExtraWork({
      approvalToken: token,
      approved,
      approvedByName: extra?.job.booking?.match?.jobRequest?.customer?.name,
    })
  }

  const customer = extra.job.booking?.match?.jobRequest?.customer
  const category = extra.job.booking?.match?.jobRequest?.category

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <ApprovalCard
          token={token}
          description={extra.description}
          amount={Number(extra.amount)}
          customerName={customer?.name ?? ''}
          serviceName={category ?? ''}
          onAction={handleApproval}
        />
      </div>
    </div>
  )
}
