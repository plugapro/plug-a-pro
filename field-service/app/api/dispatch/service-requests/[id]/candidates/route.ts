import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { rankCandidatesForJobRequest } from '@/lib/matching/service'

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
    const message = error instanceof Error ? error.message : 'Unable to rank candidates'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}

