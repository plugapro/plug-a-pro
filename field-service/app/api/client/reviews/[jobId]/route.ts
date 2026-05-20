import { NextResponse } from 'next/server'
import { submitJobReview } from '@/lib/server/client'

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params
    const body = await request.json()
    await submitJobReview(jobId, {
      rating: Number(body.rating ?? 5),
      tags: Array.isArray(body.tags) ? body.tags : [],
      text: typeof body.text === 'string' ? body.text : '',
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 })
  }
}

