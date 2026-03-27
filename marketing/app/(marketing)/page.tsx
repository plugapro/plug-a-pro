import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Hero } from "@/components/marketing/Hero";
import { Features } from "@/components/marketing/Features";
import { SocialProof } from "@/components/marketing/SocialProof";
import { PricingCards } from "@/components/marketing/PricingCards";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({});

export default function HomePage() {
  return (
    <>
      <Hero />
      <Features />
      <SocialProof />
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Simple, transparent pricing</h2>
          <PricingCards />
        </div>
      </section>
      <CTAStrip />
    </>
  );
}
