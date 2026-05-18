import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireProviderApi } from '@/lib/auth'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionOrError = await requireProviderApi()
  if (sessionOrError instanceof Response) return sessionOrError
  const session = sessionOrError

  const { id } = await params

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })

  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }

  const intent = await db.paymentIntent.findFirst({
    where: { id, providerId: provider.id },
    select: { status: true, creditedAt: true },
  })

  if (!intent) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    status: intent.status,
    creditedAt: intent.creditedAt?.toISOString() ?? null,
  })
}
