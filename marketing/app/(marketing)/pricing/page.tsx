import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { PricingCards } from "@/components/marketing/PricingCards";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({ title: "Pricing", noIndex: true });

export default function PricingPage() {
  return (
    <>
      <div className="py-24 text-center px-4">
        <h1 className="text-5xl font-bold mb-4">Pricing</h1>
        <p className="text-muted-foreground text-xl max-w-xl mx-auto">
          Simple pricing that scales with you.
        </p>
      </div>
      <div className="max-w-5xl mx-auto px-4 pb-16">
        <PricingCards />
      </div>
      <CTAStrip />
    </>
  );
}
