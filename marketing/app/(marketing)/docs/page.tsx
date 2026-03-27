import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { getAllDocs } from "@/lib/content";

export const metadata: Metadata = buildMetadata({ title: "Documentation" });

export default async function DocsPage() {
  const docs = await getAllDocs();

  // Group by section
  const sections = docs.reduce<Record<string, typeof docs>>((acc, doc) => {
    const section = doc.section ?? "General";
    if (!acc[section]) acc[section] = [];
    acc[section].push(doc);
    return acc;
  }, {});

  // Sort within sections by order
  for (const section of Object.values(sections)) {
    section.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  return (
    <div className="py-24 max-w-5xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-12">Documentation</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        {Object.entries(sections).map(([section, entries]) => (
          <div key={section}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              {section}
            </h2>
            <ul className="space-y-3">
              {entries.map((doc) => (
                <li key={doc.slug}>
                  <Link href={`/docs/${doc.slug}`} className="group flex items-start gap-2">
                    <h3 className="font-medium group-hover:underline">{doc.title}</h3>
                  </Link>
                  {doc.description && (
                    <p className="text-sm text-muted-foreground mt-0.5">{doc.description}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
