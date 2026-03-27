import { defineConfig, s } from "velite";

export default defineConfig({
  root: "content",
  output: {
    data: ".velite",
    assets: "public/static",
    base: "/static/",
    name: "[name]-[hash:6].[ext]",
    clean: true,
  },
  collections: {
    blog: {
      name: "Post",
      pattern: "blog/**/*.mdx",
      schema: s.object({
        title: s.string(),
        description: s.string().optional(),
        date: s.isodate(),
        author: s.string().optional(),
        tags: s.array(s.string()).optional().default([]),
        cover: s.string().optional(),
        draft: s.boolean().optional().default(false),
        slug: s.path(),
        body: s.mdx(),
      }),
    },
    changelog: {
      name: "ChangelogEntry",
      pattern: "changelog/**/*.mdx",
      schema: s.object({
        title: s.string(),
        version: s.string(),
        date: s.isodate(),
        type: s.enum(["feat", "fix", "breaking"]),
        slug: s.path(),
        body: s.mdx(),
      }),
    },
    docs: {
      name: "Doc",
      pattern: "docs/**/*.mdx",
      schema: s.object({
        title: s.string(),
        description: s.string().optional(),
        order: s.number().optional().default(0),
        section: s.string().optional().default("General"),
        slug: s.path(),
        body: s.mdx(),
      }),
    },
  },
});
