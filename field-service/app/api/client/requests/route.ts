import { NextRequest, NextResponse } from 'next/server'
import { createDraftRequest, saveDraftRequest } from '@/lib/server/client'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const address =
      body.address && typeof body.address === 'object'
        ? {
            street: String(body.address.street ?? body.address.addressLine1 ?? '').trim(),
            suburb: String(body.address.suburb ?? '').trim(),
            city: String(body.address.city ?? '').trim(),
            province: String(body.address.province ?? 'Gauteng').trim(),
            postalCode: body.address.postalCode ? String(body.address.postalCode).trim() : undefined,
            unitNumber: body.address.unitNumber ? String(body.address.unitNumber).trim() : null,
            complexName: body.address.complexName ? String(body.address.complexName).trim() : null,
            accessNotes: body.address.accessNotes ? String(body.address.accessNotes).trim() : null,
          }
        : body.address
          ? {
              street: String(body.address).trim(),
              suburb: 'Unknown',
              city: 'Unknown',
              province: 'Gauteng',
            }
          : null

    const maxCallOutFee =
      typeof body.maxCallOutFee === 'number'
        ? body.maxCallOutFee
        : typeof body.maxCallOutFee === 'string'
          ? Number.parseFloat(body.maxCallOutFee)
          : null

    const result = await createDraftRequest({
      category: body.category ?? 'Plumbing',
      subcategory: body.subcategory ?? null,
      title: body.description?.slice(0, 80) ?? body.title ?? 'New request',
      description: body.description ?? '',
      schedule: body.schedule ?? 'asap',
      budgetPreference: body.budgetPreference ?? null,
      providerPreference: body.providerPreference ?? null,
      maxCallOutFee: Number.isFinite(maxCallOutFee) ? maxCallOutFee : null,
      verifiedOnly: Boolean(body.verifiedOnly),
      address,
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
