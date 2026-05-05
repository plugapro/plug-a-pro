import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  ProviderOpportunityResponseError,
  getSafeProviderOpportunityPreview,
  respondToProviderOpportunity,
} from '@/lib/provider-opportunity-responses'

type OpportunityResponseBody = {
  response?: 'INTERESTED' | 'NOT_INTERESTED'
  callOutFee?: string | number | null
  estimatedArrivalAt?: string | null
  rateType?: string | null
  rateAmount?: string | number | null
  negotiable?: boolean
  providerNote?: string | null
  idempotencyKey?: string | null
}

async function getAuthenticatedProvider() {
  const session = await getSession()
  if (!session || session.role !== 'provider') return null

  return db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })
}

function statusForOpportunityError(error: ProviderOpportunityResponseError) {
  if (error.code === 'NOT_FOUND') return 404
  if (error.code === 'FORBIDDEN') return 403
  if (error.code === 'EXPIRED' || error.code === 'ALREADY_ACCEPTED') return 409
  return 400
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const provider = await getAuthenticatedProvider()
  if (!provider) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { leadId } = await params
    const preview = await getSafeProviderOpportunityPreview(leadId, provider.id)
    if (!preview) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    return NextResponse.json({ opportunity: preview })
  } catch (error) {
    if (error instanceof ProviderOpportunityResponseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: statusForOpportunityError(error) })
    }
    throw error
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const provider = await getAuthenticatedProvider()
  if (!provider) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as OpportunityResponseBody
  const { leadId } = await params
  const idempotencyKey = body.idempotencyKey
    ?? request.headers.get('idempotency-key')
    ?? request.headers.get('x-idempotency-key')

  try {
    const result = await respondToProviderOpportunity({
      leadId,
      providerId: provider.id,
      response: body.response ?? 'NOT_INTERESTED',
      callOutFeeText: body.callOutFee == null ? null : String(body.callOutFee),
      estimatedArrivalAt: body.estimatedArrivalAt ? new Date(body.estimatedArrivalAt) : null,
      rateType: body.rateType ?? null,
      rateAmountText: body.rateAmount == null ? null : String(body.rateAmount),
      negotiable: body.negotiable,
      providerNote: body.providerNote ?? null,
      source: 'provider_api',
      idempotencyKey,
    })

    return NextResponse.json({
      ok: true,
      response: result.response,
      creditsDeducted: result.creditsDeducted,
    })
  } catch (error) {
    if (error instanceof ProviderOpportunityResponseError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: statusForOpportunityError(error) })
    }
    throw error
  }
}
