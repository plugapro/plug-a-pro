// ─── Cron: Post-job completion checks (cash pilot) ────────────────────────────
// Runs daily at 09:00 UTC (11:00 SAST) via Vercel Cron.
import { NextResponse } from 'next/server'
import { sendPendingCompletionChecks, retryPendingCompletionChecks } from '@/lib/completion-check'
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`)
    return new NextResponse('Unauthorized', { status: 401 })
  const cronStart = Date.now(); const cronName = 'completion-check'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))
  try {
    const [n, r] = await Promise.all([sendPendingCompletionChecks(), retryPendingCompletionChecks()])
    const duration = Date.now() - cronStart
    console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, new: n, retries: r, timestamp: new Date().toISOString() }))
    return NextResponse.json({ new: n, retries: r, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}
