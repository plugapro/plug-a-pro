import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTemplate } from '@/lib/whatsapp'
import { isEnabled } from '@/lib/flags'
import { findLatestActiveProviderApplicationByPhone } from '@/lib/provider-applications'
import { mintResumeTokenForDraft } from '@/lib/provider-registration/pwa-flow'
import { runDraftAbandonmentNudge } from '@/lib/provider-registration/abandonment-nudge'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const result = await runDraftAbandonmentNudge({
    now: () => new Date(),
    db,
    findActiveApplication: findLatestActiveProviderApplicationByPhone,
    mintResumeToken: mintResumeTokenForDraft,
    sendTemplate,
    flagEnabled: (key: string) => isEnabled(key as Parameters<typeof isEnabled>[0]),
  })
  console.log(JSON.stringify({ event: 'cron_complete', cron: 'draft-abandonment-nudge', ...result }))
  return NextResponse.json(result)
}
