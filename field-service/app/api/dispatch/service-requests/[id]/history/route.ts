import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { getDispatchHistory } from '@/lib/matching/service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params

  const history = await getDispatchHistory(id)
  return NextResponse.json({ jobRequestId: id, history })
}

