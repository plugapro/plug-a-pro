import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/metadata";
import { getAllDocs, getDocBySlug } from "@/lib/content";
import { MDXContent } from "@/components/shared/MDXContent";

export async function generateStaticParams() {
  const docs = await getAllDocs();
  return docs.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);
  if (!doc) return buildMetadata({ title: "Not Found" });
  return buildMetadata({ title: doc.title, description: doc.description });
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);
  if (!doc) notFound();

  return (
    <article className="py-24 max-w-3xl mx-auto px-4">
      <header className="mb-12">
        <h1 className="text-4xl font-bold">{doc.title}</h1>
        {doc.description && (
          <p className="text-xl text-muted-foreground mt-4">{doc.description}</p>
        )}
      </header>
      <MDXContent code={doc.body} />
    </article>
  );
}
