import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      // /api hosts the lead-capture + chat endpoints; not useful to crawlers
      // and we don't want them showing up in search results.
      { userAgent: "*", disallow: "/api/" },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
