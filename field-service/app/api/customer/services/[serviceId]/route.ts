// ─── GET /api/customer/services/[serviceId] ───────────────────────────────────
// Returns public service details. No auth required.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params

  const service = await db.service.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      pricingType: true,
      basePrice: true,
      callOutFee: true,
      duration: true,
      active: true,
      businessId: true,
    },
  })

  if (!service || !service.active) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({
    ...service,
    basePrice: service.basePrice ? Number(service.basePrice) : null,
    callOutFee: service.callOutFee ? Number(service.callOutFee) : null,
  })
}
