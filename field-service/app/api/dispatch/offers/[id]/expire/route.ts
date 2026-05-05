import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { expireAssignmentOffer } from '@/lib/matching/service'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminApi()
  if (authError) return authError
  const { id } = await params

  const result = await expireAssignmentOffer({ assignmentHoldId: id })
  return NextResponse.json(result)
}

