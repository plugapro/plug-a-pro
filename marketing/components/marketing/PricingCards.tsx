import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { siteConfig } from "@/lib/metadata";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    description: "Get started for free.",
    features: ["Feature A", "Feature B", "1 project"],
    cta: "Get started",
    href: siteConfig.links.app,
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$29/mo",
    description: "For growing teams.",
    features: ["Everything in Free", "Feature C", "Unlimited projects", "Priority support"],
    cta: "Start free trial",
    href: siteConfig.links.app,
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For large organizations.",
    features: ["Everything in Pro", "SLA", "Dedicated support", "Custom integrations"],
    cta: "Contact us",
    href: "/contact",
    highlighted: false,
  },
];

export function PricingCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {TIERS.map((tier) => (
        <div
          key={tier.name}
          className={`rounded-xl border p-6 flex flex-col gap-6 ${
            tier.highlighted ? "border-foreground shadow-lg" : "border-border"
          }`}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-lg">{tier.name}</h3>
              {tier.highlighted && <Badge>Most popular</Badge>}
            </div>
            <p className="text-3xl font-bold">{tier.price}</p>
            <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
          </div>
          <ul className="space-y-2 flex-1">
            {tier.features.map((f) => (
              <li key={f} className="text-sm flex gap-2 items-start">
                <span className="text-muted-foreground">✓</span> {f}
              </li>
            ))}
          </ul>
          <Button nativeButton={false} render={<Link href={tier.href} />} variant={tier.highlighted ? "default" : "outline"} className="w-full">
            {tier.cta}
          </Button>
        </div>
      ))}
    </div>
  );
}
