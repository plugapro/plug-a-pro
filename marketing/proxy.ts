import { NextResponse } from 'next/server'

// Add X-Robots-Tag: noindex on all preview and development deployments so
// search engines never index non-production URLs (*.vercel.app, preview branches, localhost).
// Production (VERCEL_ENV === 'production') is exempt — robots.txt and sitemap handle that.
export function proxy() {
  const response = NextResponse.next()
  if (process.env.VERCEL_ENV !== 'production') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  return response
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
}
