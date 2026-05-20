import { NextResponse } from 'next/server'
import { getAuthenticatedCustomerContext, getRequestForClient } from '@/lib/server/client'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const request = await getRequestForClient(id, auth.customer.id)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ status: request.status })
}
