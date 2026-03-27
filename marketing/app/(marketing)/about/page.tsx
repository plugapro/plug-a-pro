import type { Metadata } from "next";
import { buildMetadata, siteConfig } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({ title: "About" });

export default function AboutPage() {
  return (
    <>
      <div className="py-24 max-w-3xl mx-auto px-4">
        <h1 className="text-5xl font-bold mb-6">About {siteConfig.name}</h1>
        <p className="text-muted-foreground text-xl mb-12">{siteConfig.description}</p>
        <div className="prose prose-zinc dark:prose-invert max-w-none">
          <h2>Our mission</h2>
          <p>Replace this with your venture&apos;s mission statement.</p>
          <h2>The team</h2>
          <p>Replace this with team bios and photos.</p>
        </div>
      </div>
      <CTAStrip />
    </>
  );
}
