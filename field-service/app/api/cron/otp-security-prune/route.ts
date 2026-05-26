import { NextResponse } from 'next/server'
import { pruneTerminalOtpChallenges } from '@/lib/otp-security'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const startedAt = Date.now()
  const result = await pruneTerminalOtpChallenges()
  const durationMs = Date.now() - startedAt

  console.info(JSON.stringify({
    event: 'otp.challenge.pruned',
    deleted: result.deleted,
    durationMs,
  }))

  return NextResponse.json({ ok: true, deleted: result.deleted, durationMs })
}
