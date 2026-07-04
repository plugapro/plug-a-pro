import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashProviderVerificationToken } from '@/lib/provider-verification-token'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'token_required' }, { status: 400 })
  }

  const hash = hashProviderVerificationToken(token)
  const verification = await db.providerIdentityVerification.findUnique({
    where: { accessTokenHash: hash },
    select: { status: true, decision: true },
  })

  if (!verification) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({ status: verification.status, decision: verification.decision })
}
