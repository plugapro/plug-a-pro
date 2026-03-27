import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Hero } from "@/components/marketing/Hero";
import { ProblemStatement } from "@/components/marketing/ProblemStatement";
import { WhoItsFor } from "@/components/marketing/WhoItsFor";
import { HowItWorksSteps } from "@/components/marketing/HowItWorksSteps";
import { OperatingModel } from "@/components/marketing/OperatingModel";
import { Features } from "@/components/marketing/Features";
import { SocialProof } from "@/components/marketing/SocialProof";
import { PricingCards } from "@/components/marketing/PricingCards";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({});

export default function HomePage() {
  return (
    <>
      <Hero />
      <ProblemStatement />
      <WhoItsFor />
      <HowItWorksSteps />
      <OperatingModel />
      <Features />
      <SocialProof />
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">How it works for each side</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Simple and fair for customers and workers alike.
          </p>
          <PricingCards />
        </div>
      </section>
      <CTAStrip />
    </>
  );
}
