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

// Resolved before nextConfig so the CSP below can include the Sentry ingest
// origins only when a DSN is configured (audit OBS-01). Also gates the
// withSentryConfig wrapper at the bottom of this file.
const sentryDsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

// Sentry browser SDK posts envelopes to o<org>.ingest[.region].sentry.io.
// Follow the Sentry CSP docs pattern with wildcard ingest hosts rather than
// hardcoding an org-specific origin. Empty (inert) when no DSN is set.
const sentryConnectSrc = sentryDsn
  ? ' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io https://*.sentry.io'
  : ''

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
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net https://www.googletagmanager.com", // unsafe-inline/eval required for Next.js dev + RSC
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com",
              "font-src 'self' data:",
              `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com https://www.facebook.com https://www.google-analytics.com https://region1.google-analytics.com${sentryConnectSrc}`,
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

// Only wrap with Sentry's Next.js plugin when a DSN is configured.
// Without a DSN the plugin has nothing to instrument, and its config
// modifications can cause Vercel's modifyConfig hook to throw when
// org/project/authToken are absent (seen with @sentry/nextjs@10.x).
export default sentryDsn
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      telemetry: false,
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
    })
  : nextConfig
