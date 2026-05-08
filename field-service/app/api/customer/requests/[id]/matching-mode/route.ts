import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import {
  RequestMatchingModeError,
  type CustomerMatchingMode,
  selectCustomerRequestMatchingMode,
} from '@/lib/request-matching-mode'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, context: RouteContext) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  const { id } = await context.params

  let body: { mode?: CustomerMatchingMode }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const mode = body.mode
  if (mode !== 'quick_match' && mode !== 'review_first') {
    return NextResponse.json({ error: 'Unsupported matching mode' }, { status: 400 })
  }

  try {
    const result = await selectCustomerRequestMatchingMode({
      requestId: id,
      customerId: customer.id,
      mode,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof RequestMatchingModeError) {
      if (error.code === 'REQUEST_NOT_FOUND') {
        return NextResponse.json({ error: error.code }, { status: 404 })
      }
      if (error.code === 'FORBIDDEN') {
        return NextResponse.json({ error: error.code }, { status: 403 })
      }
      if (error.code === 'REQUEST_NOT_EDITABLE') {
        return NextResponse.json({ error: error.code }, { status: 409 })
      }
      return NextResponse.json({ error: error.code }, { status: 400 })
    }
    console.error('[api/customer/requests/matching-mode] unexpected failure', {
      requestId: id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to select matching mode' }, { status: 500 })
  }
}
