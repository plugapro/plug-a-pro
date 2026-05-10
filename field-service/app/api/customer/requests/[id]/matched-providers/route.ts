import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { getMatchedProvidersForCustomerRequest, ReviewFirstError } from '@/lib/review-first'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, context: RouteContext) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  const { id } = await context.params
  const batchParam = req.nextUrl.searchParams.get('batch')
  const batch = batchParam ? Number.parseInt(batchParam, 10) : 1

  try {
    const matches = await getMatchedProvidersForCustomerRequest({
      requestId: id,
      customerId: customer.id,
      batch,
    })

    // Safe customer-facing fields only.
    return NextResponse.json({
      requestId: matches.requestId,
      batch: matches.batch,
      hasMore: matches.hasMore,
      count: matches.providers.length,
      providers: matches.providers.map((provider) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        profilePhotoUrl: provider.profilePhotoUrl,
        mainSkill: provider.mainSkill,
        secondarySkills: provider.secondarySkills,
        serviceArea: provider.serviceArea,
        serviceZones: provider.serviceZones,
        labourRateText: provider.labourRateText,
        trustLevel: provider.trustLevel,
        summary: provider.summary,
        availabilityIndicator: provider.availabilityIndicator,
        rank: provider.rank,
        score: provider.score,
        whyMatched: provider.whyMatched,
        profileUrl: provider.profileUrl,
      })),
    })
  } catch (error) {
    if (error instanceof ReviewFirstError) {
      if (error.code === 'REQUEST_NOT_FOUND') {
        return NextResponse.json({ error: error.code }, { status: 404 })
      }
      if (error.code === 'FORBIDDEN') {
        return NextResponse.json({ error: error.code }, { status: 403 })
      }
      if (error.code === 'INVALID_BATCH') {
        return NextResponse.json({ error: error.code }, { status: 400 })
      }
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    console.error('[api/customer/requests/matched-providers] unexpected failure', {
      requestId: id,
      customerId: customer.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to load matched providers' }, { status: 500 })
  }
}

