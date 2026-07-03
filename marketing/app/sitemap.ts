import type { MetadataRoute } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { siteConfig } from "@/lib/metadata";
import { serviceScopeMatrix } from "@/content/services/service-scope";
import {
  PILOT_AREA_SLUGS,
  getAreaServiceLandingPairs,
} from "@/content/areas/area-content";

// Static, evergreen marketing routes. Slice E will add /areas/[city] +
// /areas/[city]/[service] on top; keep this list flat and easy to extend.
const STATIC_ROUTES = [
  "",
  "/about",
  "/blog",
  "/changelog",
  "/contact",
  "/credits-policy",
  "/docs",
  "/faq",
  "/features",
  "/for-customers",
  "/for-providers",
  "/for-workers",
  "/how-it-works",
  "/onboarding",
  "/pricing",
  "/privacy",
  "/services",
  "/solutions",
  "/terms",
  "/trust",
] as const;

interface VeliteCollectionItem {
  slug: string;
  draft?: boolean;
}

function readVeliteCollection(name: string): VeliteCollectionItem[] {
  try {
    const raw = readFileSync(
      join(process.cwd(), ".velite", `${name}.json`),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // .velite/ absent on a fresh checkout — sitemap still works, MDX routes
    // are simply skipped. Build pipeline runs `velite build` before
    // `next build`, so production deployments always have the JSON.
    return [];
  }
}

// Velite stores slugs with the collection prefix ("blog/hello-world");
// strip it so we get the route-relative segment.
function bareSlug(veliteSlug: string): string {
  const parts = veliteSlug.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : veliteSlug;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url;
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: path === "" ? 1.0 : 0.7,
  }));

  const serviceEntries: MetadataRoute.Sitemap = serviceScopeMatrix.map(
    (service) => ({
      url: `${base}/services/${service.slug}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    }),
  );

  const areaEntries: MetadataRoute.Sitemap = PILOT_AREA_SLUGS.map(
    (citySlug) => ({
      url: `${base}/areas/${citySlug}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    }),
  );

  const areaServiceEntries: MetadataRoute.Sitemap = getAreaServiceLandingPairs().map(
    ({ citySlug, serviceSlug }) => ({
      url: `${base}/areas/${citySlug}/${serviceSlug}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    }),
  );

  const mdxCollections: Array<[string, VeliteCollectionItem[]]> = [
    ["blog", readVeliteCollection("blog").filter((p) => !p.draft)],
    ["changelog", readVeliteCollection("changelog").filter((p) => !p.draft)],
    ["docs", readVeliteCollection("docs").filter((p) => !p.draft)],
  ];
  const mdxEntries: MetadataRoute.Sitemap = mdxCollections.flatMap(
    ([collection, items]) =>
      items.map((item) => ({
        url: `${base}/${collection}/${bareSlug(item.slug)}`,
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.6,
      })),
  );

  return [
    ...staticEntries,
    ...serviceEntries,
    ...areaEntries,
    ...areaServiceEntries,
    ...mdxEntries,
  ];
}
