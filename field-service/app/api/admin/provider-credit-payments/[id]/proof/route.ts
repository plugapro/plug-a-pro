import { type NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { db } from '@/lib/db'
import { getProviderPaymentProof } from '@/lib/storage'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireAdminApi()
  if (unauthorized) return unauthorized

  const { id } = await params
  const intent = await db.paymentIntent.findUnique({
    where: { id },
    select: { proofOfPaymentUrl: true },
  })

  if (!intent?.proofOfPaymentUrl) {
    return NextResponse.json({ error: 'Proof of payment not found' }, { status: 404 })
  }

  try {
    const proof = await getProviderPaymentProof(intent.proofOfPaymentUrl)
    if (!proof || proof.statusCode !== 200 || !proof.stream) {
      return NextResponse.json({ error: 'Proof of payment not found' }, { status: 404 })
    }

    return new NextResponse(proof.stream, {
      headers: {
        'Content-Type': proof.blob.contentType,
        'Content-Length': String(proof.blob.size),
        'Content-Disposition': proof.blob.contentDisposition,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[admin/provider-credit-payments/proof] Failed to fetch payment proof:', {
      paymentIntentId: id,
      error,
    })
    return NextResponse.json(
      { error: 'Could not load proof of payment' },
      { status: 502 },
    )
  }
}
