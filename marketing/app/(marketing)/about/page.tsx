import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { whatsappNumberDisplay } from "@/lib/whatsapp";
import { WhatsAppButton } from "@/components/marketing/WhatsAppButton";

export const metadata: Metadata = buildMetadata({
  title: "About",
  description:
    "Plug A Pro connects customers with nearby local service providers for small home and business jobs, all through WhatsApp.",
});

export default function AboutPage() {
  return (
    <>
      <div className="py-24 max-w-3xl mx-auto px-4">
        <h1 className="text-5xl font-bold mb-6">About Plug A Pro</h1>
        <p className="text-muted-foreground text-xl mb-12">
          A marketplace connecting customers with nearby local service providers for small home jobs. Built for South Africa, runs on WhatsApp.
        </p>
        <div className="prose prose-zinc dark:prose-invert max-w-none">
          <h2>What we do</h2>
          <p>
            When something breaks at home, finding a trustworthy person to fix it is harder than it should be. You either know someone or you don&apos;t. Plug A Pro solves that.
          </p>
          <p>
            We match customers with skilled local service providers in their area: plumbers, painters, gardeners, handymen, appliance repairers and more. Customers describe the job on WhatsApp. We find nearby available local pros. Both sides connect, confirm and get the job done.
          </p>

          <h2>For service providers</h2>
          <p>
            South Africa has hundreds of thousands of skilled local tradespeople and independent service providers who earn job to job. Most find work through word of mouth, standing outside hardware stores or WhatsApp groups. That&apos;s not a reliable pipeline.
          </p>
          <p>
            Plug A Pro connects local service providers with matched job leads based on their skills and the areas they cover. No app to download. No monthly fees. Matched leads reach them on the WhatsApp they already use.
          </p>

          <h2>How it works</h2>
          <p>
            Customers message us on WhatsApp to describe a job. We match them to nearby local pros. The service provider reviews the lead, accepts it, does an inspection if needed and submits a written quote. The customer approves. The job happens. Both sides leave a review.
          </p>
          <p>
            Neither side shares their personal number until both parties have confirmed. We handle all communication until the job is underway.
          </p>

          <h2>Built for the real world</h2>
          <p>
            We design for South African conditions: mobile-first, WhatsApp-primary and built for budget Android devices on patchy data. No apps to install, no accounts to create before you can get help.
          </p>

          <h2>Get in touch</h2>
          <p>
            We&apos;re in early access. Start on WhatsApp at {whatsappNumberDisplay} or use the contact page if you need something else.
          </p>
          <p>
            <WhatsAppButton source="about_get_in_touch" audience="customer" />
          </p>
        </div>
      </div>
      <CTAStrip />
    </>
  );
}
