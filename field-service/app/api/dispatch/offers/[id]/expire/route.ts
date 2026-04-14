import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { expireAssignmentOffer } from '@/lib/matching/service'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params

  const result = await expireAssignmentOffer({ assignmentHoldId: id })
  return NextResponse.json(result)
}

