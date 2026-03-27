import type { Metadata } from "next";

export const siteConfig = {
  venture: "plug-a-pro",
  name: "Plug-A-Pro",
  description:
    "Find nearby handymen and home-job workers via WhatsApp. Get quotes, book help, and get the job done — safely and simply.",
  url: "https://plugapro.co.za", // TODO: update with production URL
  accent: "oklch(0.55 0.2 250)",
  ogImage: "/og.png",
  whatsappNumber: "+27000000000", // TODO: update with real WhatsApp number
  links: {
    app: "https://app.plugapro.co.za", // TODO: update with production app URL
    twitter: "https://twitter.com/plugapro", // TODO: update with real handle
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
