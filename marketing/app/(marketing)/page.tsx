import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Hero } from "@/components/marketing/Hero";
import { SocialProof } from "@/components/marketing/SocialProof";
import { ProblemStatement } from "@/components/marketing/ProblemStatement";
import { HowItWorksSteps } from "@/components/marketing/HowItWorksSteps";
import { Features } from "@/components/marketing/Features";
import { OperatingModel } from "@/components/marketing/OperatingModel";
import { WhoItsFor } from "@/components/marketing/WhoItsFor";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Link from "next/link";

export const metadata: Metadata = buildMetadata({
  description:
    "Plug-A-Pro is a WhatsApp-first field service platform for South African service businesses. Book, dispatch, track, and invoice — all from WhatsApp.",
});

const FAQ_PREVIEW = [
  {
    q: "Do my customers need to download an app?",
    a: "No. Customers book entirely through WhatsApp. No app download, no account creation, no email needed. Works on any Android with WhatsApp.",
  },
  {
    q: "How do technicians receive jobs?",
    a: "Technicians get a WhatsApp notification when a job is assigned. They confirm, navigate to the site, and update job status through a lightweight PWA that installs like a website — no App Store required.",
  },
  {
    q: "Is Plug-A-Pro free to use?",
    a: "Plug-A-Pro is currently free during our pilot phase. We are onboarding select service businesses across South Africa. Pricing will be announced after the pilot.",
  },
];

export default function HomePage() {
  return (
    <>
      <Hero />
      <SocialProof />
      <ProblemStatement />
      <HowItWorksSteps />
      <Features />
      <OperatingModel />
      <WhoItsFor />

      {/* FAQ preview */}
      <section className="py-20 md:py-24 px-4 border-t border-border/40">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              Common questions
            </p>
            <h2 className="text-3xl font-bold">Quick answers</h2>
          </div>
          <Accordion className="w-full">
            {FAQ_PREVIEW.map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger>{faq.q}</AccordionTrigger>
                <AccordionContent>{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <div className="text-center mt-8">
            <Link
              href="/faq"
              className="text-sm font-medium underline-offset-4 hover:underline"
              style={{ color: "var(--accent-brand)" }}
            >
              See all frequently asked questions →
            </Link>
          </div>
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
