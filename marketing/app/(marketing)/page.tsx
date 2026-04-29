import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Hero } from "@/components/marketing/Hero";
import { ProblemStatement } from "@/components/marketing/ProblemStatement";
import { ProviderStorySection } from "@/components/marketing/ProviderStorySection";
import { WhoItsFor } from "@/components/marketing/WhoItsFor";
import { HowItWorksSteps } from "@/components/marketing/HowItWorksSteps";
import { OperatingModel } from "@/components/marketing/OperatingModel";
import { Features } from "@/components/marketing/Features";
import { TrustSafety } from "@/components/marketing/TrustSafety";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { SectionTracker } from "@/components/analytics/SectionTracker";
import { ScrollDepthTracker } from "@/components/analytics/ScrollDepthTracker";

export const metadata: Metadata = buildMetadata({});

export default function HomePage() {
  return (
    <>
      <SectionTracker />
      <ScrollDepthTracker />
      <div id="section-hero"><Hero /></div>
      <div id="section-problem"><ProblemStatement /></div>
      <div id="section-provider-story"><ProviderStorySection /></div>
      <div id="section-how-it-works"><HowItWorksSteps /></div>
      <div id="section-who-its-for"><WhoItsFor /></div>
      <div id="section-trust"><TrustSafety /></div>
      <div id="section-operating-model"><OperatingModel /></div>
      <div id="section-features"><Features /></div>
      {/* SocialProof hidden until real reviews are collected */}
      {/* <div id="section-social-proof"><SocialProof /></div> */}
      <div id="section-cta"><CTAStrip /></div>
    </>
  );
}
