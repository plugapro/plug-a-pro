import type { Metadata } from "next";

export const siteConfig = {
  venture: "plug-a-pro",
  name: "Plug-A-Pro",
  description:
    "Run your service business from WhatsApp. Book, dispatch, and complete jobs — no app required.",
  url: "https://plugapro.co.za",
  accent: "oklch(0.50 0.22 290)", // violet — propagates to --accent-brand CSS token
  ogImage: "/og.png",
  // TODO: replace with real Plug-A-Pro WhatsApp number before go-live
  whatsappNumber: "+27100000000",
  links: {
    app: "https://app.plugapro.co.za",
    twitter: "https://twitter.com/plugapro",
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
