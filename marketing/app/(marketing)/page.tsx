import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Hero } from "@/components/marketing/Hero";
import { ProblemStatement } from "@/components/marketing/ProblemStatement";
import { WhoItsFor } from "@/components/marketing/WhoItsFor";
import { HowItWorksSteps } from "@/components/marketing/HowItWorksSteps";
import { OperatingModel } from "@/components/marketing/OperatingModel";
import { Features } from "@/components/marketing/Features";
import { TrustSafety } from "@/components/marketing/TrustSafety";
import { SocialProof } from "@/components/marketing/SocialProof";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({});

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorksSteps />
      <ProblemStatement />
      <WhoItsFor />
      <TrustSafety />
      <OperatingModel />
      <Features />
      <SocialProof />
      <CTAStrip />
    </>
  );
}
