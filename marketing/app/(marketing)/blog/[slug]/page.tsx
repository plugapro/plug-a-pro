import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/metadata";
import { getAllPosts, getPostBySlug } from "@/lib/content";
import { MDXContent } from "@/components/shared/MDXContent";

// Next.js 16 - params is a Promise, must be awaited
export async function generateStaticParams() {
  const posts = await getAllPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return buildMetadata({ title: "Not Found" });
  return buildMetadata({
    title: post.title,
    description: post.description,
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  return (
    <article className="py-24 max-w-3xl mx-auto px-4">
      <header className="mb-12">
        <p className="text-xs text-muted-foreground mb-2">{post.date}</p>
        <h1 className="text-4xl font-bold">{post.title}</h1>
        {post.description && (
          <p className="text-xl text-muted-foreground mt-4">{post.description}</p>
        )}
      </header>
      <MDXContent code={post.body} />
    </article>
  );
}
