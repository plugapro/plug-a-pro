"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import { buildWhatsAppLink, whatsappMessages } from "@/lib/whatsapp";

const SIDES = [
  {
    audience: "For customers",
    emoji: "🏠",
    headline: "Free to request help",
    description:
      "Describe your job, get matched to nearby local pros, and receive written quotes — at no cost. You only pay the service provider for the job itself.",
    points: [
      "No platform fee to request a match",
      "Approve quotes before any work begins",
      "Keep the booking and job updates on WhatsApp",
      "Payment arranged through the platform after job completion — method confirmed with each booking",
    ],
    cta: "Start on WhatsApp",
    href: buildWhatsAppLink(whatsappMessages.customer),
    ctaAudience: "customer" as const,
    highlight: false,
  },
  {
    audience: "For service providers",
    emoji: "🔧",
    headline: "Simple, fair access to customers",
    description:
      "Register your skills and service areas, receive matched job leads on WhatsApp, and build a visible reputation over time. No upfront fees to join.",
    points: [
      "Free to register and create your profile",
      "Receive matched leads based on your trade and area",
      "Small credit fee per lead unlock (announced at launch, before it applies)",
      "Build a review history that earns you more leads",
    ],
    cta: "Join as a service provider",
    href: buildWhatsAppLink(whatsappMessages.worker),
    ctaAudience: "worker" as const,
    highlight: true,
  },
];

export function PricingCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
      {SIDES.map((side) => (
        <div
          key={side.audience}
          className={`rounded-xl border p-6 flex flex-col gap-6 ${
            side.highlight ? "border-foreground shadow-lg" : "border-border"
          }`}
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
              {side.audience}
            </p>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-2xl" aria-hidden="true">{side.emoji}</span>
              <h3 className="font-bold text-xl">{side.headline}</h3>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{side.description}</p>
          </div>
          <ul className="space-y-2 flex-1">
            {side.points.map((p) => (
              <li key={p} className="text-sm flex gap-2 items-start">
                <span className="text-muted-foreground">✓</span> {p}
              </li>
            ))}
          </ul>
          <Button
            nativeButton={false}
            render={<Link href={side.href} target="_blank" rel="noopener noreferrer" />}
            variant={side.highlight ? "default" : "outline"}
            className="w-full"
            onClick={() => {
              analytics.whatsappClick(`pricing_cards_${side.ctaAudience}`);
              analytics.ctaClick(side.cta, "pricing_cards", side.ctaAudience);
            }}
          >
            {side.cta}
          </Button>
        </div>
      ))}
    </div>
  );
}
