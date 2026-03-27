import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Features } from "@/components/marketing/Features";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({ title: "Features", noIndex: true });

export default function FeaturesPage() {
  return (
    <>
      <div className="py-24 text-center px-4">
        <h1 className="text-5xl font-bold mb-4">Features</h1>
        <p className="text-muted-foreground text-xl max-w-xl mx-auto">
          Everything you need to build and grow.
        </p>
      </div>
      <Features />
      <CTAStrip />
    </>
  );
}
