import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { getDispatchHistory } from '@/lib/matching/service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminApi()
  if (authError) return authError
  const { id } = await params

  const history = await getDispatchHistory(id)
  return NextResponse.json({ jobRequestId: id, history })
}

