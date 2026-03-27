import type { Metadata } from "next";

export const siteConfig = {
  venture: "my-product",          // used as leads.venture in Supabase
  name: "My Product",
  description: "One-line pitch.",
  url: "https://myproduct.com",
  accent: "oklch(0.55 0.2 250)",  // swap per venture — propagates to CSS token
  ogImage: "/og.png",
  whatsappNumber: "+1234567890",  // single source of truth — no env var
  links: {
    app: "https://app.myproduct.com",
    twitter: "https://twitter.com/myproduct",
  },
} as const;

export function buildMetadata(overrides: {
  title?: string;
  description?: string;
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const title = overrides.title
    ? `${overrides.title} | ${siteConfig.name}`
    : siteConfig.name;

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
