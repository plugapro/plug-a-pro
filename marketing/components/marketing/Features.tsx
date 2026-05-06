import type { LucideIcon } from "lucide-react";
import {
  MapPin,
  Phone,
  FileText,
  Navigation,
  Camera,
  Star,
} from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: MapPin,
    title: "Local matching",
    description:
      "Jobs are matched to nearby service providers by proximity and skill. Customers get a local provider quickly. Providers get jobs they can actually reach.",
  },
  {
    icon: Phone,
    title: "Safe contact",
    description:
      "Plug A Pro handles the intake, matching, quote approval, and status updates from the platform number so jobs can move forward without forcing direct contact at the start.",
  },
  {
    icon: FileText,
    title: "Structured quotes",
    description:
      "Quotes are submitted in writing with a description and price. Customers approve before any work begins. No verbal agreements.",
  },
  {
    icon: Navigation,
    title: "Live job tracking",
    description:
      "Customers get WhatsApp updates at every stage: provider on the way, arrived, job started, completed. No more chasing for updates.",
  },
  {
    icon: Camera,
    title: "Before & after photos",
    description:
      "Service providers upload photos at the start and end of every job. Proof for both sides, protecting against disputes.",
  },
  {
    icon: Star,
    title: "Trusted reviews",
    description:
      "Every completed job builds the provider profile. Customers can see reviews before they accept a quote.",
  },
];

export function Features() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">
          Everything that makes the match work
        </h2>
        <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
          From job description to completion, the platform handles matching, communication, quoting, tracking, and trust.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="space-y-3">
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon
                    className="size-5"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
