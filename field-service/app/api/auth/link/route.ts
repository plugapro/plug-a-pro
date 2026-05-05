// POST /api/auth/link
// Called immediately after a successful phone OTP verification on the client,
// once POST /api/auth/session has set the HttpOnly session cookie.
// Links the authenticated Supabase user to the existing WhatsApp-created
// Customer record (if one exists), or creates a fresh Customer row.
//
// Body: { phone: string }
// Returns: { customerId: string, isNew: boolean }
//
// Security: userId is sourced from the server-verified session cookie, not the
// request body, so a caller cannot impersonate another user.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession, linkCustomerAccount } from '@/lib/auth'

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

    const result = await linkCustomerAccount({ userId: session.id, phone })

    return NextResponse.json({ customerId: result.id, isNew: result.isNew })
  } catch (err) {
    console.error('[api/auth/link] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
