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

  it("getPostBySlug returns post or null", async () => {
    const post = await getPostBySlug("hello-world");
    expect(post).not.toBeNull();
    expect(post?.slug).toBe("hello-world");
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
