import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, DM_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { siteConfig } from '@/lib/metadata'

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-ui',
  display: 'swap',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})
import { MobileGate } from '@/components/shared/mobile-gate'
import { MetaPixel } from '@/components/meta-pixel'
import { GoogleAnalytics } from '@/components/google-analytics'
import { ConsentBanner } from '@/components/consent-banner'
import { UtmCapture } from '@/components/utm-capture'
import './globals.css'

// GA4 uses the SAME measurement ID as the marketing site so app.plugapro.co.za and
// plugapro.co.za report to one GA4 property (cross-domain funnel). Env-driven, and
// loaded only on the production deployment so preview/local traffic never pollutes it.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? 'G-R3RH07RQ3G'
const GA_ENABLED = process.env.VERCEL_ENV === 'production' && Boolean(GA_ID)

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
  description: siteConfig.description,
  metadataBase: new URL(siteConfig.url),
  manifest: '/manifest.json',
  applicationName: siteConfig.name,
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/favicon.ico'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: siteConfig.name,
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630 }],
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#050608' },
  ],
  colorScheme: 'dark light',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1, // prevent zoom in PWA mode
  userScalable: false,
  viewportFit: 'cover', // allow safe-area-inset-* to work on notched devices
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${dmMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <MetaPixel />
        {GA_ENABLED && <GoogleAnalytics gaId={GA_ID} />}
        <UtmCapture />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <MobileGate>{children}</MobileGate>
          </TooltipProvider>
          <Toaster richColors position="top-center" />
          {GA_ENABLED && <ConsentBanner />}
        </ThemeProvider>
      </body>
    </html>
  )
}
