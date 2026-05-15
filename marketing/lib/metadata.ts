import type { Metadata } from "next";

export const siteConfig = {
  venture: "plug-a-pro",
  name: "Plug A Pro",
  tagline: "Reliable Local Services Made Simple",
  description:
    "Find trusted plumbers, handymen, repair and maintenance providers through Plug A Pro. One simple number handles requests, quotes and updates so you get help without the chase.",
  url: "https://plugapro.co.za", // TODO: update with production URL
  accent: "oklch(0.55 0.2 250)",
  ogImage: "/og.png",
  whatsappNumber: "+27 69 355 2447",
  links: {
    app: "https://app.plugapro.co.za",
    twitter: "https://x.com/EdgeDiscip40626",
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
}): Metadata {
  const title = overrides.title
    ? `${overrides.title} | ${siteConfig.name}`
    : `${siteConfig.name} | ${siteConfig.tagline}`;

  return {
    metadataBase: new URL(siteConfig.url),
    title,
    description: overrides.description ?? siteConfig.description,
    openGraph: {
      title,
      description: overrides.description ?? siteConfig.description,
      url: siteConfig.url,
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
