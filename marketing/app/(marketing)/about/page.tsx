import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "About",
  description:
    "Plug-A-Pro connects homeowners to independent local workers for small home jobs — all through WhatsApp.",
});

export default function AboutPage() {
  return (
    <>
      <div className="py-24 max-w-3xl mx-auto px-4">
        <h1 className="text-5xl font-bold mb-6">About Plug-A-Pro</h1>
        <p className="text-muted-foreground text-xl mb-12">
          A marketplace connecting homeowners to independent local workers — built for South Africa, run on WhatsApp.
        </p>
        <div className="prose prose-zinc dark:prose-invert max-w-none">
          <h2>What we do</h2>
          <p>
            When something breaks at home, finding a trustworthy person to fix it is harder than it should be. You either know someone, or you don&apos;t. Plug-A-Pro solves that.
          </p>
          <p>
            We match homeowners with skilled independent workers in their area — plumbers, painters, gardeners, handymen, appliance repairers, and more. Customers describe the job on WhatsApp. We find nearby available workers. Both sides connect, confirm, and get the job done.
          </p>

          <h2>For workers</h2>
          <p>
            South Africa has hundreds of thousands of skilled independent workers who earn their living job to job. Most find work through word of mouth, standing outside hardware stores, or WhatsApp groups. That&apos;s not a reliable pipeline.
          </p>
          <p>
            Plug-A-Pro gives independent workers a steady flow of matched local leads — jobs that fit their skills and the suburbs they cover. No app to download. No monthly fees. Work comes to them on the WhatsApp they already use.
          </p>

          <h2>How it works</h2>
          <p>
            Customers message us on WhatsApp to describe a job. We match them to nearby available workers. Workers review the lead, accept it, do an inspection if needed, and submit a quote. The customer approves. The job happens. Both sides leave a review.
          </p>
          <p>
            Neither side shares their personal number until both parties have confirmed. The platform mediates all communication until the job is underway.
          </p>

          <h2>Built for the real world</h2>
          <p>
            We design for South African conditions: mobile-first, WhatsApp-primary, and built for budget Android devices on patchy data. No apps to install, no accounts to create before you can get help.
          </p>

          <h2>Get in touch</h2>
          <p>
            We&apos;re in early access.{" "}
            <a href="/waitlist">Join the waitlist</a> to be among the first homeowners or workers on the platform, or{" "}
            <a href="/contact">contact us</a> directly.
          </p>
        </div>
      </div>
      <CTAStrip />
    </>
  );
}
