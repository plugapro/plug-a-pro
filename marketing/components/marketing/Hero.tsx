"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import { buildWhatsAppLink, whatsappMessages } from "@/lib/whatsapp";

export function Hero() {
  return (
    <section
      className="relative py-24 md:py-32 text-center px-4 overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg, oklch(0.14 0.07 250) 0%, oklch(0.10 0.02 260) 60%, oklch(0.11 0 0) 100%)",
        "--foreground": "oklch(0.985 0 0)",
        "--color-foreground": "oklch(0.985 0 0)",
        "--muted-foreground": "oklch(0.985 0 0 / 0.62)",
        "--color-muted-foreground": "oklch(0.985 0 0 / 0.62)",
        "--primary": "var(--accent-brand)",
        "--color-primary": "var(--accent-brand)",
        "--primary-foreground": "oklch(0.985 0 0)",
        "--color-primary-foreground": "oklch(0.985 0 0)",
        "--border": "oklch(1 0 0 / 15%)",
        "--color-border": "oklch(1 0 0 / 15%)",
      } as React.CSSProperties}
    >
      {/* subtle dot-grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />
      <div className="relative max-w-4xl mx-auto" style={{ color: "oklch(0.985 0 0)" }}>
        <p className="text-xs font-medium uppercase tracking-widest mb-4 brand-gradient-text">
          Local help. Real quotes. On WhatsApp.
        </p>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
          Find trusted local help for small jobs. Quoted in writing, on WhatsApp.
        </h1>
        <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
          Tell us what you need and we&apos;ll match you to a nearby service provider.
          Keep your request moving with written quotes, WhatsApp updates,
          and clear handover steps for both sides.
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
              analytics.whatsappClick("hero_primary");
              analytics.ctaClick("Start on WhatsApp", "hero", "customer");
            }}
          >
            Start on WhatsApp
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/how-it-works" />}
            variant="outline"
            size="lg"
            style={{ borderColor: "rgba(255,255,255,0.6)", color: "oklch(0.985 0 0)", background: "transparent" }}
            onClick={() => analytics.howItWorksClick("hero_secondary_cta")}
          >
            Learn how it works
          </Button>
        </div>
        {/* Trust bullets */}
        <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm" style={{ color: "oklch(0.985 0 0 / 0.7)" }}>
          <span>✓ Free for customers</span>
          <span>✓ No app download needed</span>
          <span>✓ Launching in Johannesburg &amp; Pretoria</span>
        </div>
      </div>
    </section>
  );
}
