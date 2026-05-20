import { NextResponse } from 'next/server'
import { getAuthenticatedCustomerContext, getJobForClient } from '@/lib/server/client'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const job = await getJobForClient(id, auth.customer.id)
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    status: job.status,
    etaMins: job.status === 'EN_ROUTE' ? 14 : null,
    extras: job.extras.map((extra) => ({
      id: extra.id,
      description: extra.description,
      amount: Number(extra.amount),
      status: extra.status,
    })),
  })
}
