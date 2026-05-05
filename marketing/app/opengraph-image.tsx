import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/metadata";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 700 }}>{siteConfig.name}</div>
        <div style={{ fontSize: 24, color: "#71717a", marginTop: 16 }}>
          {siteConfig.description}
        </div>
      </div>
    ),
    size
  );
}
