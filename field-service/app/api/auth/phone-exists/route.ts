import { NextResponse, type NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  // Consume the body so malformed clients do not get a timing distinction from
  // route-level parsing, then return the same non-enumerating shape for all calls.
  await req.json().catch(() => ({}))

  return NextResponse.json(
    {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Not found',
    },
    { status: 404 },
  )
}
