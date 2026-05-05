import { ImageResponse } from "next/og";
import { getPostBySlug } from "@/lib/content";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  const title = post?.title ?? "Blog Post";
  const date = post?.date ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: 80,
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ fontSize: 16, color: "#71717a", marginBottom: 16 }}>
          {date}
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>
          {title}
        </div>
      </div>
    ),
    size
  );
}
