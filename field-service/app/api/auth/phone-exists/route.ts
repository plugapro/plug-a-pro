import { NextResponse, type NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  // Keep the legacy route non-enumerating for stale clients while sign-in moves
  // directly to Supabase OTP. Do not parse, validate, or query by phone here.
  await req.text().catch(() => '')
  return NextResponse.json({ ok: true })
}
