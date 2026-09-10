import type { MetadataRoute } from 'next'

// app.plugapro.co.za is the booking PWA + admin surface — not an SEO surface.
// Every route is gated by proxy.ts (sign-in, tokens, or admin role) so there
// is nothing for a crawler to index. Disallowing the whole tree is the right
// protocol-level signal; the proxy is the actual enforcement.
// /vodapay is allowed: it's the VodaPay super-app mini-program entry, publicly
// reachable before any session exists, and VodaPay's crawler/validator needs
// to fetch it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/vodapay', disallow: '/' },
    ],
  }
}
