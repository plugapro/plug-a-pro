import { NextRequest, NextResponse } from 'next/server'
import { buildAcceptedLeadContactUrl } from '@/lib/post-match-communications'
import { createTraceId } from '@/lib/support-diagnostics'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params
  const token = request.nextUrl.searchParams.get('leadToken') ?? ''
  const traceId = createTraceId('contact')
  const url = await buildAcceptedLeadContactUrl({ leadId, token })

  if (!url) {
    console.warn('[provider/contact-customer] access denied', {
      traceId,
      leadId,
      hasToken: Boolean(token),
    })
    return NextResponse.json(
      { error: 'Lead contact is not available', traceId },
      { status: 403, headers: { 'X-Trace-Id': traceId } },
    )
  }

  return NextResponse.redirect(url)
}
