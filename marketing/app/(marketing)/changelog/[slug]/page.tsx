import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/metadata";
import { getAllChangelog, getChangelogBySlug } from "@/lib/content";
import { MDXContent } from "@/components/shared/MDXContent";
import { Badge } from "@/components/ui/badge";

export async function generateStaticParams() {
  const entries = await getAllChangelog();
  return entries.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = await getChangelogBySlug(slug);
  if (!entry) return buildMetadata({ title: "Not Found" });
  return buildMetadata({ title: `${entry.version} - ${entry.title}` });
}

export default async function ChangelogEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = await getChangelogBySlug(slug);
  if (!entry) notFound();

  const TYPE_LABELS: Record<string, string> = { feat: "Feature", fix: "Fix", breaking: "Breaking" };

  return (
    <article className="py-24 max-w-3xl mx-auto px-4">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <Badge>{TYPE_LABELS[entry.type] ?? entry.type}</Badge>
          <span className="font-mono text-sm text-muted-foreground">{entry.version}</span>
          <span className="text-xs text-muted-foreground">{entry.date}</span>
        </div>
        <h1 className="text-4xl font-bold">{entry.title}</h1>
      </header>
      <MDXContent code={entry.body} />
    </article>
  );
}
