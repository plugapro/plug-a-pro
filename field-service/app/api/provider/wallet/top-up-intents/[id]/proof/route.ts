import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { uploadProviderPaymentProof } from '@/lib/storage'

const PROOF_MUTABLE_STATUSES = ['CREATED', 'PENDING_PAYMENT', 'PROOF_UPLOADED', 'MATCHED_ON_STATEMENT'] as const

function nextStatus(status: string) {
  return status === 'MATCHED_ON_STATEMENT' ? 'MATCHED_ON_STATEMENT' : 'PROOF_UPLOADED'
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const { id } = await params
  const intent = await db.paymentIntent.findFirst({
    where: {
      id,
      providerId: provider.id,
      paymentMethod: 'MANUAL_EFT',
    },
  })

  if (!intent) {
    return NextResponse.json({ error: 'Payment intent not found' }, { status: 404 })
  }

  if (!PROOF_MUTABLE_STATUSES.includes(intent.status as (typeof PROOF_MUTABLE_STATUSES)[number])) {
    return NextResponse.json(
      { error: `Cannot upload proof for a ${intent.status.toLowerCase()} payment intent.` },
      { status: 409 },
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const upload = formData.get('file') ?? formData.get('proof')
  if (!(upload instanceof File)) {
    return NextResponse.json({ error: 'No proof file provided' }, { status: 400 })
  }

  try {
    const proofUploadedAt = new Date().toISOString()
    const proofOfPaymentUrl = await uploadProviderPaymentProof({
      paymentIntentId: intent.id,
      file: upload,
    })

    const updated = await db.paymentIntent.update({
      where: { id: intent.id },
      data: {
        proofOfPaymentUrl,
        status: nextStatus(intent.status),
        metadata: {
          ...(typeof intent.metadata === 'object' && intent.metadata && !Array.isArray(intent.metadata)
          ? intent.metadata
          : {}),
          proofUploadedAt,
          proofUploadedByUserId: session.id,
        },
      },
    })

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      proofUploaded: Boolean(updated.proofOfPaymentUrl),
      proofUploadedAt,
    })
  } catch (error) {
    console.error('[provider/wallet/top-up-intents/proof] Failed to upload proof of payment:', error)
    return NextResponse.json(
      { error: 'Could not upload proof of payment. Please try again.' },
      { status: 422 },
    )
  }
}
