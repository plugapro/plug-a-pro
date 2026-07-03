import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { getAllPosts } from "@/lib/content";

export const metadata: Metadata = buildMetadata({
  title: "Blog",
  description:
    "Guides and updates from Plug A Pro on home maintenance, hiring local service providers and getting small jobs done right in South Africa.",
});

export default async function BlogPage() {
  const posts = await getAllPosts();

  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-12">Blog</h1>
      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet.</p>
      ) : (
        <ul className="space-y-8">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link href={`/blog/${post.slug}`} className="block group">
                <p className="text-xs text-muted-foreground mb-1">{post.date}</p>
                <h2 className="text-xl font-semibold group-hover:underline">{post.title}</h2>
                {post.description && (
                  <p className="text-muted-foreground mt-1">{post.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
