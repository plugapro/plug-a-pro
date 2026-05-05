// ─── Customer WhatsApp Preferences API ────────────────────────────────────────
// GET: return the customer's current WhatsApp preference fields
// PATCH: update whatsappMarketingOptIn by calling applyOptIn or applyOptOut

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { applyOptIn, applyOptOut } from '@/lib/whatsapp-policy'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!session.phone) return NextResponse.json({ error: 'No phone on session' }, { status: 400 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const customer = await db.customer.findUnique({
    where: { phone: session.phone },
    select: {
      whatsappServiceOptIn: true,
      whatsappMarketingOptIn: true,
      whatsappMarketingOptInAt: true,
      whatsappMarketingOptOutAt: true,
    },
  })

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  return NextResponse.json(customer)
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!session.phone) return NextResponse.json({ error: 'No phone on session' }, { status: 400 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { whatsappMarketingOptIn?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body.whatsappMarketingOptIn !== 'boolean') {
    return NextResponse.json(
      { error: 'whatsappMarketingOptIn must be a boolean' },
      { status: 400 }
    )
  }

  if (body.whatsappMarketingOptIn) {
    await applyOptIn(session.phone, 'pwa')
  } else {
    await applyOptOut(session.phone, 'pwa')
  }

  return NextResponse.json({ ok: true })
}
