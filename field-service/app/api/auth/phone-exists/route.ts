import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/utils'

type SignInRole = 'customer' | 'provider'

export async function POST(req: NextRequest) {
  let body: { phone?: string; role?: SignInRole }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const phone = normalizePhone(body.phone ?? '')
  const role = body.role

  if (!/^\+\d{10,15}$/.test(phone) || (role !== 'customer' && role !== 'provider')) {
    return NextResponse.json({ error: 'Invalid phone lookup request' }, { status: 400 })
  }

  if (role === 'customer') {
    const customer = await db.customer.findUnique({
      where: { phone },
      select: { id: true },
    })
    return NextResponse.json({ exists: Boolean(customer) })
  }

  const provider = await db.provider.findUnique({
    where: { phone },
    select: { id: true, active: true },
  })

  return NextResponse.json({ exists: Boolean(provider?.active) })
}
