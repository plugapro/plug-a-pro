import type { LucideIcon } from "lucide-react";
import { CreditCard, MapPin, MessageCircle, Star, UserRoundCheck } from "lucide-react";

export const providerPageContent = {
  metadata: {
    title: "For Service Providers",
    description:
      "Register as a local service provider on Plug A Pro. Receive nearby small-job leads on WhatsApp, quote in writing and build reputation through completed jobs.",
  },
  eyebrow: "For service providers",
  title: "Nearby jobs. Clear lead costs. Written records.",
  intro:
    "Apply once, set the areas you cover and receive suitable small-job previews on WhatsApp. You stay in control of which leads you unlock and accept.",
  benefits: [
    {
      icon: MapPin,
      title: "Leads matched to your area",
      body: "Set your service areas once. Suitable requests are matched against area, service type and availability.",
    },
    {
      icon: MessageCircle,
      title: "Works on WhatsApp",
      body: "Onboarding, lead previews and secure job links start from the WhatsApp you already use.",
    },
    {
      icon: UserRoundCheck,
      title: "Marketplace access is reviewed",
      body: "Your application is reviewed before live marketplace access. Customer details unlock only after the lead rules are met.",
    },
    {
      icon: CreditCard,
      title: "Credits shown before acceptance",
      body: "Lead previews are visible before credits are used. Wallet records show top-ups, deductions and reversals.",
    },
    {
      icon: Star,
      title: "Reputation from completed jobs",
      body: "Quotes, updates, photos and real reviews help build a stronger profile over time.",
    },
  ] satisfies Array<{ icon: LucideIcon; title: string; body: string }>,
  joinSteps: [
    {
      step: "1",
      title: "Start on WhatsApp",
      detail: "Share your name, service types, areas, availability and any requested profile evidence.",
    },
    {
      step: "2",
      title: "Operations reviews your application",
      detail: "The team reviews the application before marketplace access and sends an update on WhatsApp.",
    },
    {
      step: "3",
      title: "Activate your profile",
      detail: "After approval for marketplace access, open the provider portal to review profile details, availability and credits.",
    },
    {
      step: "4",
      title: "Preview and unlock leads",
      detail: "A suitable lead preview shows the service type and area before credits are used.",
    },
    {
      step: "5",
      title: "Accept, quote and update",
      detail: "After acceptance, send the written quote, agree timing and keep the job record updated.",
    },
  ],
  serviceTypes: [
    "General home repairs",
    "Garden and lawn care",
    "Cleaning",
    "Small plumbing jobs",
    "Carpentry tasks",
    "Tiling touch-ups",
    "DIY and flat-pack assembly",
    "Painting touch-ups",
  ],
} as const;
