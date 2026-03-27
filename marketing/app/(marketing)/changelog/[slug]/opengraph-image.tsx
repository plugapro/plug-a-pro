import { ImageResponse } from "next/og";
import { getChangelogBySlug } from "@/lib/content";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = await getChangelogBySlug(slug);
  const title = entry?.title ?? "Changelog";
  const version = entry?.version ?? "";
  const type = entry?.type ?? "";

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 80, width: "100%", height: "100%", background: "#0a0a0a", color: "#fafafa" }}>
        <div style={{ fontSize: 14, color: "#71717a", marginBottom: 8 }}>
          {version} {type ? `· ${type}` : ""}
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
      </div>
    ),
    size
  );
}
