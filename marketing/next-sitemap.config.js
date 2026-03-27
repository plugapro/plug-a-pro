// next-sitemap.config.js
// Per spec: MDX slugs must be included via additionalPaths — not automatic.
// The Velite output (.velite/) is read at sitemap generation time (postbuild).
// Note: .velite/index.js uses ES module syntax, so we require the JSON files directly.
// If .velite/ is absent (e.g. first run), slugs are excluded with a warning.
let blog = [], changelog = [], docs = [];
try {
  blog = require("./.velite/blog.json");
  changelog = require("./.velite/changelog.json");
  docs = require("./.velite/docs.json");
} catch {
  console.warn("[next-sitemap] .velite/ output not found — MDX slugs excluded from sitemap. Run `npx velite build` to regenerate.");
}

/** Strip the leading collection-folder segment from a Velite path slug. */
function bareSlug(veliteSlug) {
  const parts = veliteSlug.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : veliteSlug;
}

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://plugapro.co.za",
  generateRobotsTxt: true,
  robotsTxtOptions: {
    policies: [
      { userAgent: "*", allow: "/" },
      { userAgent: "*", disallow: "/api/" },
    ],
  },
  additionalPaths: async (config) => {
    const blogPaths = blog
      .filter((p) => !p.draft)
      .map((p) => ({ loc: `/blog/${bareSlug(p.slug)}` }));
    const changelogPaths = changelog.map((c) => ({
      loc: `/changelog/${bareSlug(c.slug)}`,
    }));
    const docPaths = docs.map((d) => ({ loc: `/docs/${bareSlug(d.slug)}` }));
    return [...blogPaths, ...changelogPaths, ...docPaths];
  },
};
