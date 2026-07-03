import { describe, it, expect } from "vitest";
import { getAllPosts, getPostBySlug, getAllChangelog, getAllDocs } from "@/lib/content";

describe("content helpers", () => {
  it("getAllPosts returns an array", async () => {
    const posts = await getAllPosts();
    expect(Array.isArray(posts)).toBe(true);
  });

  it("getAllPosts filters drafts by default", async () => {
    const posts = await getAllPosts();
    expect(posts.every((p) => !p.draft)).toBe(true);
  });

  it("getPostBySlug returns null for drafts and unknown slugs", async () => {
    // hello-world is the template placeholder, kept as draft: true so it
    // never reaches lists, detail pages or the sitemap.
    const draft = await getPostBySlug("hello-world");
    expect(draft).toBeNull();
    const missing = await getPostBySlug("does-not-exist");
    expect(missing).toBeNull();
  });

  it("getAllChangelog and getAllDocs filter drafts", async () => {
    const entries = await getAllChangelog();
    const docs = await getAllDocs();
    expect(entries.every((e) => !e.draft)).toBe(true);
    expect(docs.every((d) => !d.draft)).toBe(true);
  });

  it("getAllChangelog returns an array", async () => {
    const entries = await getAllChangelog();
    expect(Array.isArray(entries)).toBe(true);
  });

  it("getAllDocs returns an array", async () => {
    const docs = await getAllDocs();
    expect(Array.isArray(docs)).toBe(true);
  });
});
