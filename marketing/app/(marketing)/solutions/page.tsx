import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import { Wrench, Zap, Wind, Home, Lock } from "lucide-react";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "Solutions",
  description:
    "Plug-A-Pro supports home maintenance, plumbing, electrical, HVAC, locksmith, and any field service business that dispatches technicians to customer locations.",
});

const SOLUTIONS: { icon: LucideIcon; name: string; headline: string; points: string[] }[] = [
  {
    icon: Home,
    name: "General Home Maintenance",
    headline: "Practical home support — repairs, upkeep, and DIY project completion",
    points: [
      "Multiple service types in one catalogue — painting, tiling, carpentry, plumbing repairs",
      "Customers book the specific service they need, including half-finished DIY jobs",
      "Fast dispatch: assign from available technicians in one tap",
      "Lightweight technician PWA works on any budget Android device",
      "Payment collected before dispatch — no cash handling required",
      "Started a home repair yourself? Book a project completion job from the same flow.",
    ],
  },
  {
    icon: Wrench,
    name: "Plumbing & Drainage",
    headline: "From WhatsApp booking to invoiced completion",
    points: [
      "Customers book emergency callouts or scheduled repairs via WhatsApp",
      "Admin assigns the nearest available plumber instantly",
      "Technician gets full job details on their phone — no phone calls",
      "Extra work (e.g. pipe replacement) approved by customer via WhatsApp before proceeding",
      "Before/after photos uploaded on job completion",
      "Invoice auto-generated and sent to customer immediately",
    ],
  },
  {
    icon: Zap,
    name: "Electrical Contractors",
    headline: "Compliance, fault-finding, and installations — all tracked",
    points: [
      "Customers request fault-finding or installation quotes via WhatsApp",
      "Admin reviews QUOTE_REQUIRED jobs and prices them before customer sees cost",
      "Technician executes with full status trail from ASSIGNED to COMPLETED",
      "Certificate of Compliance or job report attached to the completed job record",
      "Rating request sent automatically 24 hours after completion",
    ],
  },
  {
    icon: Wind,
    name: "HVAC & Refrigeration",
    headline: "Compliance-sensitive jobs with a full audit trail",
    points: [
      "Complex jobs with extra work approval flow built in",
      "Immutable job status trail: every transition logged with timestamp",
      "Before and after photos required on job completion",
      "Extra work descriptions and amounts captured formally — no verbal disputes",
      "Full job history visible in admin console for every unit serviced",
    ],
  },
  {
    icon: Lock,
    name: "Locksmith & Security",
    headline: "Emergency response with a clear customer communication trail",
    points: [
      "Emergency bookings prioritised in the dispatch queue",
      "Customer gets 'technician on the way' notification immediately",
      "Location-based job details sent to technician instantly",
      "Extra security work (e.g. lock upgrade) approved by customer before proceeding",
      "Invoice and job record available as evidence if needed",
    ],
  },
];

export default function SolutionsPage() {
  return (
    <>
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Industry solutions
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Built for field service — any trade, any size
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          If your business dispatches skilled workers to customer locations, Plug-A-Pro manages the entire job lifecycle.
        </p>
      </div>

      <div className="py-16 px-4">
        <div className="max-w-5xl mx-auto space-y-10">
          {SOLUTIONS.map((solution) => {
            const Icon = solution.icon;
            return (
              <div
                key={solution.name}
                className="rounded-2xl border border-border/40 p-8 grid md:grid-cols-3 gap-8"
              >
                <div>
                  {(() => {
                    return <Icon className="size-10 mb-3" style={{ color: "var(--accent-brand)" }} aria-hidden="true" />;
                  })()}
                  <h2 className="font-bold text-xl mb-1">{solution.name}</h2>
                  <p className="text-sm text-muted-foreground">{solution.headline}</p>
                </div>
                <ul className="md:col-span-2 space-y-3">
                  {solution.points.map((point) => (
                    <li key={point} className="flex items-start gap-3 text-sm text-muted-foreground">
                      <span
                        className="mt-1.5 size-1.5 rounded-full flex-shrink-0"
                        style={{ background: "var(--accent-brand)" }}
                        aria-hidden="true"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="py-8 px-4">
        <div className="max-w-2xl mx-auto rounded-2xl border border-border/40 p-8 bg-muted/30 text-center">
          <p className="font-semibold text-foreground mb-2">Started a DIY job that needs finishing?</p>
          <p className="text-sm text-muted-foreground mb-4">
            Plug-A-Pro connects customers with skilled technicians for any home job — including rescuing a repair that didn&apos;t go to plan. Book a project completion job from the same WhatsApp flow.
          </p>
          <a
            href="/contact"
            className="text-sm font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            Talk to us about your project →
          </a>
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
