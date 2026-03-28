// POST /api/auth/link
// Called immediately after a successful phone OTP verification on the client.
// Links the newly authenticated Supabase user to the existing WhatsApp-created
// Customer record (if one exists), or creates a fresh Customer row.
//
// Body: { userId: string, phone: string }
// Returns: { customerId: string, isNew: boolean }

import { type NextRequest, NextResponse } from 'next/server'
import { linkCustomerAccount } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, phone } = body

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }
    if (!phone || typeof phone !== 'string' || !/^\+\d{10,15}$/.test(phone)) {
      return NextResponse.json({ error: 'Valid E.164 phone required' }, { status: 400 })
    }

    const result = await linkCustomerAccount({ userId, phone })

    return NextResponse.json({ customerId: result.id, isNew: result.isNew })
  } catch (err) {
    console.error('[api/auth/link] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
