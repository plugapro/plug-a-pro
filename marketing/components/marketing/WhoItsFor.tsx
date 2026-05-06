"use client";

import type { LucideIcon } from "lucide-react";
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
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import { buildWhatsAppLink, whatsappAudienceOptions } from "@/lib/whatsapp";

const JOB_CATEGORIES: { icon: LucideIcon; name: string; description: string }[] = [
  { icon: Wrench, name: "Plumbing", description: "Taps, toilets, drains, leaks, and pipe repairs" },
  { icon: Paintbrush, name: "Painting", description: "Interior and exterior, rooms or touch-ups" },
  { icon: Flower2, name: "Garden & Lawn", description: "Mowing, clearing, trimming, and landscaping" },
  { icon: Home, name: "Handyman / Odd Jobs", description: "Shelves, fixtures, doors, tiling, and everyday repairs" },
  { icon: WashingMachine, name: "Appliances", description: "Fault-finding, inspection, and repair" },
  { icon: Zap, name: "Electrical (minor)", description: "Light fittings, plugs, and small installations" },
  { icon: Hammer, name: "DIY Assistance", description: "Stuck on a project? Get help to finish it properly" },
  { icon: ShieldCheck, name: "General Repairs", description: "Drywall, plastering, grouting, and home upkeep" },
];

const WORKER_TYPES: string[] = [
  "Gardeners and landscapers",
  "Painters",
  "Handymen and practical service providers",
  "Plumbers (small jobs)",
  "Appliance repair specialists",
  "Electricians (minor work)",
  "General maintenance service providers",
  "Roofing helpers",
];

export function WhoItsFor() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto space-y-16">

        {/* For Customers */}
        <div>
          <div className="mb-10">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              For customers
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Any small home job, sorted
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Whether you need a tap fixed, a room painted, or help finishing a DIY project, Plug A Pro matches you with a nearby local pro who can do the job.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {JOB_CATEGORIES.map((category) => {
              const Icon = category.icon;
              return (
                <div
                  key={category.name}
                  className="rounded-2xl border border-border/40 p-5 space-y-3 hover:shadow-sm transition-shadow"
                >
                  <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="font-semibold text-sm">{category.name}</h3>
                  <p className="text-xs text-muted-foreground">{category.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/40" />

        {/* For Service Providers */}
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              For service providers
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              More jobs. Less waiting.
            </h2>
            <p className="text-muted-foreground mb-6">
              You have the skills. Getting steady, paying customers is the hard part. Plug A Pro matches you to nearby customers looking for your trade, and delivers job lead previews to your WhatsApp. No registered business required.
            </p>
            <ul className="space-y-2">
              {WORKER_TYPES.map((type) => (
                <li key={type} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span
                    className="size-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                  {type}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border/40 p-8 space-y-4 bg-muted/30">
            <p className="font-semibold text-lg">What you get as a service provider</p>
            {[
              "Only jobs that match your skills and area",
              "Your price in writing. No verbal confusion.",
              "Job photos protect you if there's a dispute",
              "Customer ratings build your name over time",
              "No chasing for cash. Payment goes through the platform.",
              "Works on any smartphone with WhatsApp",
            ].map((benefit) => (
              <div key={benefit} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span
                  className="mt-1 size-1.5 rounded-full flex-shrink-0"
                  style={{ background: "var(--accent-green-wa)" }}
                  aria-hidden="true"
                />
                {benefit}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border/40 pt-12">
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              Start on WhatsApp
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Pick your path and start the conversation
            </h2>
            <p className="text-muted-foreground">
              Whether you need help at home, want more work, or want to join as a provider or partner, the first step is the same: message us on WhatsApp.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {whatsappAudienceOptions.map((option) => (
              <div
                key={option.audience}
                className="rounded-2xl border border-border/40 p-6 bg-muted/20 space-y-4"
              >
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">{option.label}</h3>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </div>
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      href={buildWhatsAppLink(option.message)}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  variant={option.audience === "customer" ? "default" : "outline"}
                  className="w-full"
                  onClick={() => {
                    analytics.whatsappClick(`who_its_for_${option.audience}`);
                    analytics.ctaClick(option.label, "who_its_for", option.audience);
                  }}
                >
                  {option.label}
                </Button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
