// POST /api/auth/link
// Called immediately after a successful phone OTP verification on the client.
// Links the newly authenticated Supabase user to the existing WhatsApp-created
// Customer record (if one exists), or creates a fresh Customer row.
//
// Body: { userId: string, phone: string }
// Returns: { customerId: string, isNew: boolean }

import { type NextRequest, NextResponse } from 'next/server'
import { linkCustomerAccount } from '@/lib/auth'
import { db } from '@/lib/db'

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

    // Resolve business context (single-tenant: from env; multi-tenant: from subdomain)
    const slug = process.env.BUSINESS_SLUG ?? ''
    const business = await db.business.findUnique({ where: { slug } })
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 500 })
    }

    const result = await linkCustomerAccount({
      userId,
      phone,
      businessId: business.id,
    })

    return NextResponse.json({ customerId: result.id, isNew: result.isNew })
  } catch (err) {
    console.error('[api/auth/link] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
