import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { ContactForm } from "@/components/marketing/ContactForm";
import { WhatsAppButton } from "@/components/marketing/WhatsAppButton";

export const metadata: Metadata = buildMetadata({
  title: "Get Started",
  description: "Get started with Plug-A-Pro. Chat on WhatsApp or send us your details and we'll be in touch within one business day.",
});

export default function ContactPage() {
  return (
    <div className="py-20 md:py-24 max-w-lg mx-auto px-4">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
        Get started
      </p>
      <h1 className="text-4xl font-bold mb-3">Let&apos;s get your business on Plug-A-Pro</h1>
      <p className="text-muted-foreground mb-8 leading-relaxed">
        Onboarding typically takes one business day. We&apos;ll configure your service catalogue, set up your WhatsApp number, and walk you through the admin console.
      </p>

      <div className="rounded-2xl border border-border/40 p-6 mb-6 flex items-start gap-4 bg-muted/20">
        <span className="text-2xl mt-0.5" aria-hidden="true">💬</span>
        <div>
          <p className="font-semibold text-sm mb-1">Fastest: Chat on WhatsApp</p>
          <p className="text-xs text-muted-foreground mb-3">
            Message us directly and we&apos;ll get back to you within the hour during business hours.
          </p>
          <WhatsAppButton />
        </div>
      </div>

      <div className="relative my-8 flex items-center gap-3">
        <div className="flex-1 border-t border-border/40" />
        <span className="text-xs text-muted-foreground uppercase tracking-widest">or send a message</span>
        <div className="flex-1 border-t border-border/40" />
      </div>

      <ContactForm />
    </div>
  );
}
