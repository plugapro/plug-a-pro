// POST /api/auth/link
// Called immediately after a successful phone OTP verification on the client,
// once POST /api/auth/session has set the HttpOnly session cookie.
// Links the authenticated Supabase user to the existing WhatsApp-created
// Customer record (if one exists) or creates a fresh Customer row.
//
// Body: { phone: string; name?: string }
// Returns: { customerId: string | null, isNew: boolean, isProvider: boolean }
//
// Security: userId is sourced from the server-verified session cookie, not the
// request body, so a caller cannot impersonate another user.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession, linkCustomerAccount } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { phone } = body

    if (!phone || typeof phone !== 'string' || !/^\+\d{10,15}$/.test(phone)) {
      return NextResponse.json({ error: 'Valid E.164 phone required' }, { status: 400 })
    }
    if (!session.phone || session.phone !== phone) {
      return NextResponse.json(
        { error: 'Phone must match the verified session phone' },
        { status: 403 }
      )
    }

    const name = typeof body.name === 'string' ? body.name.trim() : undefined
    if (name !== undefined && (name.length < 2 || name.length > 120)) {
      return NextResponse.json({ error: 'Name must be between 2 and 120 characters' }, { status: 400 })
    }

    const result = await linkCustomerAccount({ userId: session.id, phone, name })

    // Provider-only account: linkCustomerAccount deliberately did NOT create a
    // Customer record. Tell the client to block the customer journey instead of
    // routing a provider into it.
    if (result.isProviderOnly) {
      return NextResponse.json({ customerId: null, isNew: false, isProvider: true })
    }

    // A customer record exists or was linked. A Provider record may ALSO exist
    // (genuine multi-role) - surface isProvider so the client can still block.
    const provider = await db.provider.findFirst({
      where: { userId: session.id },
      select: { id: true },
    })
    const isProvider = provider !== null

    return NextResponse.json({ customerId: result.id, isNew: result.isNew, isProvider })
  } catch (err) {
    console.error('[api/auth/link] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
