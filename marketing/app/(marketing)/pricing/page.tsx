import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { whatsappNumberDisplay } from "@/lib/whatsapp";
import { WhatsAppCtaButton } from "@/components/marketing/WhatsAppCtaButton";

export const metadata: Metadata = buildMetadata({
  title: "Pricing",
  description:
    "Plug A Pro is in early access. Join free - we'll let you know how pricing works before it affects you.",
});

export default function PricingPage() {
  return (
    <div className="py-24 max-w-xl mx-auto px-4 text-center">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
        Pricing
      </p>
      <h1 className="text-4xl font-bold mb-4">Free to join during early access</h1>
      <p className="text-muted-foreground mb-4">
        Plug A Pro is currently in early access. Customers can request help and service providers can receive leads at no charge while we validate the platform.
      </p>
      <p className="text-muted-foreground mb-10">
        When we introduce monetisation - for providers, for customers or both - we&apos;ll communicate it clearly before it takes effect. No surprises.
      </p>
      <p className="text-sm font-medium mb-8">
        Start on WhatsApp at {whatsappNumberDisplay}
      </p>
      <div className="flex gap-4 justify-center flex-wrap">
        <WhatsAppCtaButton
          audience="customer"
          label="Chat on WhatsApp"
          source="pricing_customer"
          size="lg"
        />
        <WhatsAppCtaButton
          audience="worker"
          label="I want more local jobs"
          source="pricing_worker"
          variant="outline"
          size="lg"
        />
      </div>
    </div>
  );
}
