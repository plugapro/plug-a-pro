import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { getAllChangelog } from "@/lib/content";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = buildMetadata({ title: "Changelog" });

const TYPE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  feat: { label: "Feature", variant: "default" },
  fix: { label: "Fix", variant: "secondary" },
  breaking: { label: "Breaking", variant: "destructive" },
};

export default async function ChangelogPage() {
  const entries = await getAllChangelog();

  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-12">Changelog</h1>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">No entries yet.</p>
      ) : (
        <ul className="space-y-8">
          {entries.map((entry) => {
            const type = TYPE_LABELS[entry.type] ?? { label: entry.type, variant: "secondary" as const };
            return (
              <li key={entry.slug} className="border-l-2 border-border pl-6">
                <div className="flex items-center gap-3 mb-1">
                  <Badge variant={type.variant}>{type.label}</Badge>
                  <span className="font-mono text-sm text-muted-foreground">{entry.version}</span>
                  <span className="text-xs text-muted-foreground">{entry.date}</span>
                </div>
                <Link href={`/changelog/${entry.slug}`} className="group">
                  <h2 className="text-lg font-semibold group-hover:underline">{entry.title}</h2>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
