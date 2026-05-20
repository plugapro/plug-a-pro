import { NextResponse } from 'next/server'
import { getRequestForClient } from '@/lib/server/client'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const request = await getRequestForClient(id)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ status: request.status })
}
