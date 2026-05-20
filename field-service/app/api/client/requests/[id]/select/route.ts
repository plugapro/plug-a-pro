import { NextResponse } from 'next/server'
import { selectProvider } from '@/lib/server/client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json()
    const { id } = await params
    const result = await selectProvider(id, body.providerId)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 })
  }
}

