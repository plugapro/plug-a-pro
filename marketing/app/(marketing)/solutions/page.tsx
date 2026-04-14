import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import {
  Wrench,
  Zap,
  Flower2,
  Home,
  Hammer,
  WashingMachine,
  Paintbrush,
  ShieldCheck,
} from "lucide-react";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { Button } from "@/components/ui/button";
import { whatsappNumberDisplay } from "@/lib/whatsapp";
import { WhatsAppCtaButton } from "@/components/marketing/WhatsAppCtaButton";
import { WhatsAppTextLink } from "@/components/marketing/WhatsAppTextLink";

export const metadata: Metadata = buildMetadata({
  title: "Services",
  description:
    "Plug-A-Pro matches you to nearby workers for plumbing, painting, garden work, handyman jobs, appliance repairs, electrical, and DIY assistance.",
});

const SERVICES: {
  icon: LucideIcon;
  name: string;
  headline: string;
  examples: string[];
  caveat?: string;
}[] = [
  {
    icon: Home,
    name: "Handyman & General Repairs",
    headline: "Everyday home maintenance done properly",
    examples: [
      "Shelf fitting, door adjustments, hinge replacements",
      "Grouting, tiling repairs, and minor plastering",
      "Furniture assembly and mounting",
      "Drywall patching and finishing",
      "General household upkeep and odd jobs",
    ],
  },
  {
    icon: Paintbrush,
    name: "Painting",
    headline: "Interior and exterior painting — rooms or touch-ups",
    examples: [
      "Full room repaints",
      "Feature wall or accent painting",
      "Touch-up and repair painting",
      "Exterior wall and fence painting",
      "Prep work, filling, and sanding included",
    ],
  },
  {
    icon: Flower2,
    name: "Garden & Lawn",
    headline: "Outdoor spaces cleared, cut, and cared for",
    examples: [
      "Lawn mowing and edging",
      "Clearing overgrown garden areas",
      "Tree trimming and hedge cutting",
      "Weeding and general garden upkeep",
      "Planting and basic landscaping",
    ],
  },
  {
    icon: Wrench,
    name: "Plumbing (small jobs)",
    headline: "Leaks, drips, blockages, and fittings",
    examples: [
      "Tap and mixer repairs or replacements",
      "Toilet cistern and flush mechanism repairs",
      "Blocked drain clearing",
      "Shower head and fitting replacements",
      "Geyser blanket and overflow pipe checks",
    ],
  },
  {
    icon: WashingMachine,
    name: "Appliances",
    headline: "Fault-finding and repair for household appliances",
    examples: [
      "Washing machine not draining or spinning",
      "Dishwasher door, pump, or seal issues",
      "Fridge and freezer fault assessment",
      "Oven and stove element replacements",
      "Tumble dryer belt and motor faults",
    ],
  },
  {
    icon: Zap,
    name: "Electrical (minor)",
    headline: "Light fittings, plugs, and small installations",
    examples: [
      "Light fitting installation or replacement",
      "Plug and socket faults",
      "DB board trip investigation",
      "Outdoor light and sensor fitting",
      "Extending a power point or adding a switch",
    ],
    caveat: "Note: work on distribution boards, new circuits, or wiring extensions may require a Certificate of Compliance (COC) under South African law. Confirm with your provider before work begins.",
  },
  {
    icon: Hammer,
    name: "DIY Assistance",
    headline: "Started a job yourself? Get it finished properly",
    examples: [
      "Project assessment and honest advice",
      "Continuing a half-finished repair",
      "Correcting DIY work that didn't go to plan",
      "Providing the tools or materials knowledge you're missing",
      "Any home repair that got out of hand",
    ],
  },
  {
    icon: ShieldCheck,
    name: "Roofing (minor)",
    headline: "Leaks, loose tiles, and gutter repairs",
    examples: [
      "Locating and sealing roof leaks",
      "Broken or slipped tile replacement",
      "Gutter clearing and reattachment",
      "Fascia board repairs",
      "Flashing and valley repairs",
    ],
  },
];

export default function ServicesPage() {
  return (
    <>
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Services
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Small jobs done right
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          Plug-A-Pro matches you to nearby workers for a wide range of small home jobs. Describe what you need — we&apos;ll find the right person.
        </p>
        <p className="text-sm font-medium mt-6 mb-8">
          Start on WhatsApp at {whatsappNumberDisplay}
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <WhatsAppCtaButton
            audience="customer"
            label="Start on WhatsApp"
            source="solutions_header"
            size="lg"
          />
          <Button
            nativeButton={false}
            render={<Link href="/how-it-works" />}
            variant="outline"
            size="lg"
          >
            See how it works
          </Button>
        </div>
      </div>

      <div className="py-16 px-4">
        <div className="max-w-5xl mx-auto space-y-8">
          {SERVICES.map((service) => {
            const Icon = service.icon;
            return (
              <div
                key={service.name}
                className="rounded-2xl border border-border/40 p-8 grid md:grid-cols-3 gap-8"
              >
                <div>
                  <Icon
                    className="size-10 mb-3"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                  <h2 className="font-bold text-xl mb-1">{service.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {service.headline}
                  </p>
                </div>
                <div className="md:col-span-2 space-y-3">
                  <ul className="space-y-3">
                    {service.examples.map((example) => (
                      <li
                        key={example}
                        className="flex items-start gap-3 text-sm text-muted-foreground"
                      >
                        <span
                          className="mt-1.5 size-1.5 rounded-full flex-shrink-0"
                          style={{ background: "var(--accent-brand)" }}
                          aria-hidden="true"
                        />
                        {example}
                      </li>
                    ))}
                  </ul>
                  {service.caveat && (
                    <p className="text-xs text-muted-foreground border-t border-border/40 pt-3 mt-3">
                      {service.caveat}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="py-8 px-4">
        <div className="max-w-2xl mx-auto rounded-2xl border border-border/40 p-8 bg-muted/30 text-center">
          <p className="font-semibold text-foreground mb-2">
            Don&apos;t see what you need?
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            If it&apos;s a small home job, there&apos;s probably a worker near you who can do it. Describe your job and we&apos;ll try to match you.
          </p>
          <WhatsAppTextLink
            audience="customer"
            label="Request help on WhatsApp →"
            source="solutions_fallback"
          />
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
