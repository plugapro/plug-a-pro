import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Features } from "@/components/marketing/Features";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "Features",
  description:
    "WhatsApp booking, smart dispatch, technician PWA, auto-invoicing, extra work approval, and photo audit trail — all in one platform.",
});

export default function FeaturesPage() {
  return (
    <>
      <div className="py-24 text-center px-4">
        <h1 className="text-5xl font-bold mb-4">Platform features</h1>
        <p className="text-muted-foreground text-xl max-w-xl mx-auto">
          Every part of the job lifecycle — booking, dispatch, execution, invoicing — managed in one connected platform.
        </p>
      </div>
      <Features />
      <CTAStrip />
    </>
  );
}
