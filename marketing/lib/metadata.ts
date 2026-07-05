import type { Metadata } from "next";

export const siteConfig = {
  venture: "plug-a-pro",
  name: "Plug A Pro",
  legalEntity: "Kgolaentle Solutions (Pty) Ltd",
  legalEntityRegistration: "2014/077326/07",
  tagline: "Find Independent Local Service Providers",
  description:
    "Plug A Pro helps South Africans request small home jobs and connect with independent local service providers through WhatsApp and the PWA.",
  url: "https://plugapro.co.za", // TODO: update with production URL
  accent: "oklch(0.55 0.2 250)",
  ogImage: "/og.png",
  // Google Search Console site verification (URL-prefix property https://plugapro.co.za).
  // Public token — safe to commit. Rendered as <meta name="google-site-verification">
  // via Next's metadata API. Keep it in place even after verification succeeds.
  googleSiteVerification: "3_PM7x4Ump2B5tZfLEo9I31upSrnGppuKQM3nDH6Crc",
  whatsappNumber: "+27 69 355 2447",
  links: {
    app: "https://app.plugapro.co.za",
    instagram: "https://www.instagram.com/plugapro/",
    facebook: "https://www.facebook.com/plugapro",
  },
} as const;

/**
 * Returns the web app origin.
 * Reads NEXT_PUBLIC_APP_URL at runtime so deployments can override the
 * hard-coded default without touching source.
 */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? siteConfig.links.app;
}

export function buildMetadata(overrides: {
  title?: string;
  description?: string;
  image?: string;
  noIndex?: boolean;
  // Relative path like '/services/electrician'. Resolves against metadataBase
  // to produce the absolute canonical URL Google uses for deduplication.
  canonical?: string;
}): Metadata {
  const title = overrides.title
    ? `${overrides.title} | ${siteConfig.name}`
    : `${siteConfig.name} | ${siteConfig.tagline}`;
  const canonicalUrl = overrides.canonical
    ? `${siteConfig.url}${overrides.canonical}`
    : siteConfig.url;

  return {
    metadataBase: new URL(siteConfig.url),
    title,
    description: overrides.description ?? siteConfig.description,
    alternates: { canonical: canonicalUrl },
    verification: { google: siteConfig.googleSiteVerification },
    openGraph: {
      title,
      description: overrides.description ?? siteConfig.description,
      url: canonicalUrl,
      siteName: siteConfig.name,
      images: [{ url: overrides.image ?? siteConfig.ogImage }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: overrides.description ?? siteConfig.description,
      images: [overrides.image ?? siteConfig.ogImage],
    },
    ...(overrides.noIndex && { robots: { index: false, follow: false } }),
  };
}
