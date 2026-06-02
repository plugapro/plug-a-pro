"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import {
  buildWhatsAppLink,
  whatsappAudienceOptions,
  whatsappMessages,
  whatsappNumberDisplay,
} from "@/lib/whatsapp";

export function CTAStrip() {
  return (
    <section
      className="py-16 px-4"
      style={{
        background:
          "linear-gradient(135deg, var(--accent-brand) 0%, oklch(0.42 0.22 260) 100%)",
        "--foreground": "oklch(0.985 0 0)",
        "--muted-foreground": "oklch(0.985 0 0 / 0.8)",
        "--primary": "oklch(0.985 0 0)",
        "--primary-foreground": "oklch(0.14 0.07 250)",
        "--border": "oklch(1 0 0 / 30%)",
      } as React.CSSProperties}
    >
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <h2 className="text-3xl font-bold text-white">
          Start the conversation on WhatsApp.
        </h2>
        <p style={{ color: "oklch(0.985 0 0 / 0.8)" }}>
          Need a service provider, looking for work or want to join as a service provider? Start with us on WhatsApp at {whatsappNumberDisplay}.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button
            nativeButton={false}
            render={
              <Link
                href={buildWhatsAppLink(whatsappMessages.customer)}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            size="lg"
            onClick={() => {
              analytics.whatsappClick("cta_strip_primary");
              analytics.ctaClick("Chat on WhatsApp", "cta_strip", "customer");
            }}
          >
            Chat on WhatsApp
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/services" />}
            variant="outline"
            size="lg"
            onClick={() => analytics.ctaClick("View service scope", "cta_strip", "customer")}
          >
            View service scope
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/how-it-works" />}
            variant="outline"
            size="lg"
            onClick={() => analytics.howItWorksClick("cta_strip_secondary")}
          >
            See how it works
          </Button>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {whatsappAudienceOptions.map((option) => (
            <Link
              key={option.audience}
              href={buildWhatsAppLink(option.message)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
              onClick={() => {
                analytics.whatsappClick(`cta_strip_${option.audience}`);
                analytics.ctaClick(option.label, "cta_strip_audience", option.audience);
              }}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
