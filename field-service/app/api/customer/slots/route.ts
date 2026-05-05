// ─── GET /api/customer/slots ──────────────────────────────────────────────────
// Slot model removed in P2P marketplace model.
// Returns a simple availability message indicating providers will arrange timing.

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    message: 'Scheduling is arranged directly with your provider after matching.',
    slots: [],
  })
}
