import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { siteConfig } from "@/lib/metadata";

const TIERS = [
  {
    name: "Starter",
    price: "R 999/mo",
    description: "For small operations getting started.",
    features: [
      "Up to 50 jobs per month",
      "Up to 3 technicians",
      "WhatsApp booking bot",
      "Admin dispatch console",
      "Auto-invoicing",
      "Email support",
    ],
    cta: "Get started",
    href: siteConfig.links.app,
    highlighted: false,
  },
  {
    name: "Growth",
    price: "R 2 499/mo",
    description: "For growing businesses with higher job volumes.",
    features: [
      "Unlimited jobs",
      "Unlimited technicians",
      "Everything in Starter",
      "Extra work approval flow",
      "Before/after photo trail",
      "Priority support",
    ],
    cta: "Start free trial",
    href: siteConfig.links.app,
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For large operations or multiple branches.",
    features: [
      "Everything in Growth",
      "Multi-location support",
      "Custom integrations",
      "Dedicated account manager",
      "SLA guarantee",
    ],
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
