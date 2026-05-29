// ─── Venture configuration ────────────────────────────────────────────────────
// Edit this file when cloning the framework for a new venture.
// These values are used throughout the app (SEO metadata, WhatsApp deeplinks,
// lead capture, email templates, etc.)

export const siteConfig = {
  // Venture identifier - matches the 'venture' field in the database and Supabase leads table
  venture: 'plug-a-pro',

  // Display name (used in page titles, emails, etc.)
  name: 'Plug A Pro',

  // Short tagline (used in meta description, OG tags)
  description: 'Book skilled technicians via WhatsApp. Track every job. Get paid reliably.',

  // Canonical URL - no trailing slash
  url: (() => {
    const configuredUrl = (process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || '')
      .trim()
      .replace(/\/+$/, '')

    if (!configuredUrl) {
      return 'https://app.plugapro.co.za'
    }

    try {
      const url = new URL(configuredUrl)
      return `${url.origin}`
    } catch {
      return 'https://app.plugapro.co.za'
    }
  })(),

  // Primary accent colour (single oklch token - used in Tailwind + meta theme-color)
  accent: '#2563eb',

  // WhatsApp number for customer contact (international format, no spaces or dashes)
  whatsappNumber: '+27693552447',

  // Default timezone (used in slot display and job scheduling)
  timezone: 'Africa/Johannesburg',

  // Default currency
  currency: 'ZAR',

  // Service category label (shown in customer-facing UI)
  serviceCategory: 'Home Services',

  // OG image path (relative to /public)
  ogImage: '/og.png',

  // Navigation links (used in admin shell and customer nav)
  links: {
    marketing: 'https://plugapro.co.za',
    support: 'https://plugapro.co.za/contact',
    terms: 'https://plugapro.co.za/terms',
    privacy: 'https://plugapro.co.za/privacy',
  },
} as const

export type SiteConfig = typeof siteConfig

// ─── Build metadata for Next.js pages ─────────────────────────────────────────

import type { Metadata } from 'next'

export function buildMetadata(
  overrides: Partial<{
    title: string
    description: string
    path: string
    noIndex: boolean
  }> = {}
): Metadata {
  const title = overrides.title
    ? `${overrides.title} - ${siteConfig.name}`
    : siteConfig.name
  const description = overrides.description ?? siteConfig.description
  const url = overrides.path
    ? `${siteConfig.url}${overrides.path}`
    : siteConfig.url

  return {
    title,
    description,
    metadataBase: new URL(siteConfig.url),
    openGraph: {
      title,
      description,
      url,
      siteName: siteConfig.name,
      images: [{ url: siteConfig.ogImage, width: 1200, height: 630 }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [siteConfig.ogImage],
    },
    robots: overrides.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  }
}
