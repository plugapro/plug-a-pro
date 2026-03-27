import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "About",
  description: "Building the operating system for field service businesses in emerging markets.",
});

export default function AboutPage() {
  return (
    <>
      <div className="py-24 max-w-3xl mx-auto px-4">
        <h1 className="text-5xl font-bold mb-6">About Plug-A-Pro</h1>
        <p className="text-muted-foreground text-xl mb-12">
          Building the operating system for field service businesses in emerging markets.
        </p>
        <div className="prose prose-zinc dark:prose-invert max-w-none">
          <h2>Our mission</h2>
          <p>
            Millions of skilled technicians work in home services across Africa — plumbers, electricians, handymen, HVAC specialists. Most are running their businesses on WhatsApp groups and spreadsheets.
          </p>
          <p>
            Plug-A-Pro gives these businesses the operational infrastructure they deserve: structured bookings, professional dispatch, on-site job tracking, and automatic invoicing — all built around the WhatsApp channel their customers already use.
          </p>
          <h2>Built for the field</h2>
          <p>
            We design everything for real-world field conditions. Low-data PWAs that work on budget Android devices. WhatsApp flows that guide customers without friction. Admin consoles built for speed, not complexity.
          </p>
          <p>
            We support home maintenance businesses and the customers they serve — including customers who started a DIY repair and need a professional to complete it.
          </p>
          <h2>Get in touch</h2>
          <p>
            We&apos;re actively onboarding field service businesses.{" "}
            <a href="/contact">Contact us</a> to learn more or{" "}
            <a href="/waitlist">join the waitlist</a> for early access.
          </p>
        </div>
      </div>
      <CTAStrip />
    </>
  );
}
