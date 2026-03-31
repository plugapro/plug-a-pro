import Link from "next/link";
import { Button } from "@/components/ui/button";

const SIDES = [
  {
    audience: "For customers",
    emoji: "🏠",
    headline: "Free to request help",
    description:
      "Describe your job, get matched to nearby workers, and receive quotes — at no cost. You only pay the worker for the job itself.",
    points: [
      "No platform fee to request a match",
      "See worker profiles and reviews before deciding",
      "Approve quotes before any work begins",
      "Pay directly to the worker on completion",
    ],
    cta: "Request help",
    href: "/waitlist",
    highlight: false,
  },
  {
    audience: "For workers",
    emoji: "🔧",
    headline: "Simple, fair access to work",
    description:
      "Register your skills and area, receive matching job leads, and grow your local reputation. No upfront fees to join.",
    points: [
      "Free to register and create your profile",
      "Receive job leads based on your skills and area",
      "Small commission per completed job (announced at launch)",
      "Build a verified review history that earns you more leads",
    ],
    cta: "Join as a worker",
    href: "/for-workers",
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
            render={<Link href={side.href} />}
            variant={side.highlight ? "default" : "outline"}
            className="w-full"
          >
            {side.cta}
          </Button>
        </div>
      ))}
    </div>
  );
}
