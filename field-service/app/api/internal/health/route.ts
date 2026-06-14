import { NextResponse, type NextRequest } from 'next/server'
import { runHealthChecks } from '@/lib/status/health-checks'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const full = await runHealthChecks()
  return NextResponse.json(full, { status: full.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
