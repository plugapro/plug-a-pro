// lib/content.ts
// Velite compiles content to .velite/ at build time.
// In tests: run `npx velite build` before `pnpm test`.
// In production: VeliteWebpackPlugin runs automatically during `next build`.
//
// Note: Velite's s.path() produces slugs prefixed with the collection folder,
// e.g. "blog/hello-world". The helpers below strip that prefix so callers
// work with bare slugs like "hello-world".
import { blog, changelog, docs } from "@/.velite";

/** Strip the leading collection-folder segment from a Velite path slug. */
function bareSlug(veliteSlug: string): string {
  const parts = veliteSlug.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : veliteSlug;
}

export async function getAllPosts() {
  return blog
    .filter((p) => !p.draft)
    .map((p) => ({ ...p, slug: bareSlug(p.slug) }));
}

export async function getPostBySlug(slug: string) {
  // Filter drafts so direct URL access to a draft post returns null → 404
  const post = blog.find((p) => bareSlug(p.slug) === slug && !p.draft) ?? null;
  if (!post) return null;
  return { ...post, slug: bareSlug(post.slug) };
}

export async function getAllChangelog() {
  return changelog
    .filter((c) => !c.draft)
    .map((c) => ({ ...c, slug: bareSlug(c.slug) }));
}

export async function getChangelogBySlug(slug: string) {
  const entry = changelog.find((c) => bareSlug(c.slug) === slug && !c.draft) ?? null;
  if (!entry) return null;
  return { ...entry, slug: bareSlug(entry.slug) };
}

export async function getAllDocs() {
  return docs
    .filter((d) => !d.draft)
    .map((d) => ({ ...d, slug: bareSlug(d.slug) }));
}

export async function getDocBySlug(slug: string) {
  const doc = docs.find((d) => bareSlug(d.slug) === slug && !d.draft) ?? null;
  if (!doc) return null;
  return { ...doc, slug: bareSlug(doc.slug) };
}
