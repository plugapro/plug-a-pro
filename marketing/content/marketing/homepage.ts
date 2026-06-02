import type { LucideIcon } from "lucide-react";
import {
  Camera,
  FileText,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Star,
  UserRoundCheck,
} from "lucide-react";

export type HeroVariant = {
  eyebrow: string;
  headline: string;
  subheadline: string;
  primaryCtaLabel: string;
  secondaryCtaLabel: string;
  trustBullets: string[];
};

export const homepageHero: HeroVariant = {
  eyebrow: "Small everyday jobs. Start on WhatsApp.",
  headline: "Local service providers for small home jobs.",
  subheadline:
    "Tell Plug A Pro what needs fixing, installing or finishing. We help you get a nearby service provider, a written quote and WhatsApp updates without an app download.",
  primaryCtaLabel: "Start on WhatsApp",
  secondaryCtaLabel: "See how it works",
  trustBullets: [
    "No app download",
    "Written quote before work starts",
    "Provider profile visible before you proceed",
  ],
};

export const homepageHowItWorks = [
  {
    number: "01",
    title: "Send the job on WhatsApp",
    description:
      "Share the small job, area, preferred time and photos if helpful. Plug A Pro creates a structured request.",
    detail: "Good for everyday fixes, home maintenance tasks and minor repairs.",
  },
  {
    number: "02",
    title: "Review the provider profile",
    description:
      "A nearby service provider can be matched based on area, service type and availability.",
    detail: "The profile is shown before the customer proceeds.",
  },
  {
    number: "03",
    title: "Approve the written quote",
    description:
      "The provider sends price and scope in writing. Work starts only after the quote is approved.",
    detail: "Extra work also needs written approval.",
  },
  {
    number: "04",
    title: "Track the job record",
    description:
      "WhatsApp updates, photos, notes and reviews create a clearer record for both sides.",
    detail: "Support can review the record if something needs escalation.",
  },
] as const;

export const homepageFeatures: Array<{
  icon: LucideIcon;
  title: string;
  description: string;
}> = [
  {
    icon: MapPin,
    title: "Nearby local help",
    description: "Requests are matched to service providers by area and service type.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp-first flow",
    description: "Customers can start and receive updates on WhatsApp without an app download.",
  },
  {
    icon: FileText,
    title: "Written quote approval",
    description: "Price and scope are recorded before work begins.",
  },
  {
    icon: UserRoundCheck,
    title: "Profile reviewed",
    description: "Provider profiles show marketplace access status and recorded profile details.",
  },
  {
    icon: Camera,
    title: "Before and after photos",
    description: "Photos can be attached to the job record where appropriate.",
  },
  {
    icon: Star,
    title: "Real reviews",
    description: "Reviews come from completed jobs and build provider reputation over time.",
  },
  {
    icon: ShieldCheck,
    title: "Support escalation",
    description: "If a dispute arises, support reviews the written record available on the platform.",
  },
];
