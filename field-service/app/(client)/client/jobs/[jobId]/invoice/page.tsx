import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getJobForClient } from '@/lib/server/client'
import { db } from '@/lib/db'

export default async function ClientJobInvoicePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const job = await getJobForClient(jobId)
  if (!job) redirect('/client')
  const booking = job.booking
  const invoice = booking ? await db.invoice.findUnique({ where: { bookingId: booking.id } }) : null

  if (!invoice) {
    return (
      <div className="mx-auto max-w-md px-5 py-8">
        <p className="text-xl font-bold">Invoice not ready yet</p>
        <p className="mt-2 text-sm text-[var(--ink-mute)]">Please check again in a moment.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <div className="rounded-3xl border border-border bg-card p-5">
        <p className="font-mono text-xs text-[var(--ink-mute)]">Invoice #{invoice.number}</p>
        <p className="mt-1 text-2xl font-bold">R{Number(invoice.totalAmount).toFixed(2)}</p>
      </div>
      <Link href={`/ticket/${booking.match.jobRequest.customerAccessToken ?? ''}`} className="mt-4 inline-block text-sm font-semibold text-[var(--brand-purple)]">
        Open token invoice
      </Link>
    </div>
  )
}
