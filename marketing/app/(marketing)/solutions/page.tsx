import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "Solutions",
  description:
    "Plug-A-Pro supports plumbing, electrical, cleaning, HVAC, and any field service business that dispatches technicians to customer locations.",
});

const SOLUTIONS = [
  {
    icon: "🔧",
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
    icon: "⚡",
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
    icon: "🧹",
    name: "Cleaning Services",
    headline: "Recurring and once-off jobs, dispatched with zero friction",
    points: [
      "Customers choose residential, commercial, or post-construction cleaning",
      "Time slots configured by you — customers pick from available windows",
      "Technician team dispatched via the admin console in one step",
      "Arrival and completion confirmed via PWA — customer notified via WhatsApp",
      "Invoices in ZAR sent automatically on completion",
    ],
  },
  {
    icon: "❄️",
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
    icon: "🏠",
    name: "General Home Maintenance",
    headline: "High volume, low friction — exactly what handyman businesses need",
    points: [
      "Multiple service types in one catalogue — painting, tiling, carpentry, etc.",
      "Customers browse and book the specific service they need",
      "Fast dispatch: assign from available technicians in one tap",
      "Lightweight technician PWA works on any budget Android device",
      "Payment collected before dispatch — no cash handling required",
    ],
  },
  {
    icon: "🔑",
    name: "Locksmith & Security",
    headline: "Emergency response with a clear customer communication trail",
    points: [
      "Emergency bookings prioritised in the dispatch queue",
      "Customer gets \u2018technician on the way\u2019 notification immediately",
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
          {SOLUTIONS.map((solution) => (
            <div
              key={solution.name}
              className="rounded-2xl border border-border/40 p-8 grid md:grid-cols-3 gap-8"
            >
              <div>
                <span className="text-4xl mb-3 block" aria-hidden="true">{solution.icon}</span>
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
          ))}
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
