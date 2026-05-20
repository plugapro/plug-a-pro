import { NextRequest, NextResponse } from 'next/server'
import { createDraftRequest, saveDraftRequest } from '@/lib/server/client'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await createDraftRequest({
      category: body.category ?? 'Plumbing',
      title: body.description?.slice(0, 80) ?? body.title ?? 'New request',
      description: body.description ?? '',
      schedule: body.schedule ?? 'asap',
      address: body.address
        ? {
            street: body.address,
            suburb: 'Unknown',
            city: 'Unknown',
          }
        : null,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  try {
    const patch = await request.json()
    const result = await saveDraftRequest(id, patch)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 })
  }
}

