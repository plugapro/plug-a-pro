import { NextRequest, NextResponse } from 'next/server'
import { buildAcceptedLeadContactUrl } from '@/lib/post-match-communications'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params
  const token = request.nextUrl.searchParams.get('leadToken') ?? ''
  const url = await buildAcceptedLeadContactUrl({ leadId, token })

  if (!url) {
    return NextResponse.json({ error: 'Lead contact is not available' }, { status: 403 })
  }

  return NextResponse.redirect(url)
}
