import type { NextRequest, NextResponse } from 'next/server'
import { proxy } from '@/proxy'

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

export default function middleware(request: NextRequest): Promise<NextResponse> {
  return proxy(request)
}
