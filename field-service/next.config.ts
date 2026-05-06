import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

// ─── App timezone — South Africa Standard Time ────────────────────────────────
// Force the Node.js process timezone to SAST so Date constructors, default
// toLocaleString() output, cron evaluation, and message-event timestamps all
// line up with the operating market. Vercel honours this at server-start when
// it's set before Next.js boots. Local override: TZ=Africa/Johannesburg in
// .env.local.
if (!process.env.TZ) {
  process.env.TZ = 'Africa/Johannesburg'
}

const nextConfig: NextConfig = {
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(self)',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-inline/eval required for Next.js dev + RSC
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

const sentryOptions = {
  silent: true,
}

export default withSentryConfig(nextConfig, sentryOptions)
