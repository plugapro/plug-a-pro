import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { rankCandidatesForJobRequest } from '@/lib/matching/service'
import { getDispatchRouteError } from '@/lib/route-action-errors'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params

  try {
    const ranking = await rankCandidatesForJobRequest(id)
    return NextResponse.json(ranking)
  } catch (error) {
    const response = getDispatchRouteError({ action: 'candidates', error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
}
