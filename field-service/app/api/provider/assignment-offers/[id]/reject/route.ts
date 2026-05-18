import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { rejectAssignmentOffer } from '@/lib/matching/service'
import { verifyRequestOrigin } from '@/lib/csrf'
import { apiError } from '@/lib/api-response'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyRequestOrigin(request, [])) {
    return apiError('FORBIDDEN', 'Origin not allowed', 403)
  }

  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { reasonCode?: string }
  const { id } = await params

  const result = await rejectAssignmentOffer({
    leadId: id,
    providerId: provider.id,
    reasonCode: body.reasonCode,
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}
