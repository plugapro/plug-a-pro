import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthenticatedCustomerContext, getJobForClient } from '@/lib/server/client'

export default async function ClientJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client')

  const { jobId } = await params
  const job = await getJobForClient(jobId, auth.customer.id)
  if (!job) redirect('/client')
  if (job.status === 'EN_ROUTE' || job.status === 'ARRIVED' || job.status === 'STARTED' || job.status === 'AWAITING_APPROVAL') {
    redirect(`/client/jobs/${job.id}/status`)
  }
  if (job.status === 'FAILED' || job.status === 'CANCELLED') redirect('/client')

  if (job.status === 'COMPLETED') {
    return (
      <div className="mx-auto max-w-md px-5 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Job completed</h1>
        <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
          Completed by {job.provider?.name ?? 'Provider'}
        </div>
        <div className="mt-4 grid gap-2">
          <Link className="rounded-xl border border-border bg-card px-4 py-3 text-center text-sm font-semibold" href={`/client/jobs/${job.id}/invoice`}>View invoice</Link>
          <Link className="rounded-xl px-4 py-3 text-center text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }} href={`/client/jobs/${job.id}/review`}>Leave review</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Job confirmed</h1>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">{job.provider?.name ?? 'Provider'}</p>
        <p className="text-[var(--ink-mute)]">{job.booking.match.jobRequest.title}</p>
      </div>
      <Link className="mt-4 block rounded-xl px-4 py-3 text-center text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }} href={`/client/jobs/${job.id}/status`}>
        Track job
      </Link>
    </div>
  )
}
