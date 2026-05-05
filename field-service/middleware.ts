import type { NextRequest, NextResponse } from 'next/server'
import { proxy } from '@/proxy'

// Run proxy auth gating on user-facing routes while excluding static assets
// and Next internals.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

export default function middleware(request: NextRequest): Promise<NextResponse> {
  return proxy(request)
}
