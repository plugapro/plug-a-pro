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
  "Handymen and odd-job workers",
  "Plumbers (small jobs)",
  "Appliance repairers",
  "Electricians (minor work)",
  "General DIY workers and installers",
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
              Whether you need a tap fixed, a room painted, or help finishing a DIY project, Plug-A-Pro matches you with a nearby worker who can do the job.
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

        {/* For Workers */}
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              For workers
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Get steady local work, on your terms
            </h2>
            <p className="text-muted-foreground mb-6">
              If you have skills and need more paying customers, Plug-A-Pro brings the work to you. No registered business needed. Just your skills and a phone.
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
            <p className="font-semibold text-lg">What you get as a worker</p>
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

      </div>
    </section>
  );
}
