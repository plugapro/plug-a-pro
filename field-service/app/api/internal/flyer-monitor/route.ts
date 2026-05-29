import { NextResponse } from 'next/server'
import { buildFlyerMonitorReport, getFlyerMonitorReport } from '@/lib/flyer-monitor'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const report = await getFlyerMonitorReport()
    const markdown = buildFlyerMonitorReport(report)

    return NextResponse.json({
      ok: true,
      subject: report.subject,
      markdown,
      report,
    })
  } catch (error) {
    console.error('[internal/flyer-monitor] failed', {
      err: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ ok: false, error: 'flyer_monitor_failed' }, { status: 500 })
  }
}
