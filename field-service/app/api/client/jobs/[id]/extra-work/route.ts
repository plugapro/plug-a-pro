import { NextResponse } from 'next/server'
import { approveExtraWork, declineExtraWork } from '@/lib/server/client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    if (!body.extraWorkId) return NextResponse.json({ error: 'Missing extraWorkId' }, { status: 400 })
    if (body.accepted === true) await approveExtraWork(id, body.extraWorkId)
    else await declineExtraWork(id, body.extraWorkId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 })
  }
}

