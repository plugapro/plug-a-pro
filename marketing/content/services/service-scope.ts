import type { LucideIcon } from "lucide-react";
import {
  Brush,
  Flower2,
  Hammer,
  Home,
  PlugZap,
  ShowerHead,
  TriangleAlert,
  Wrench,
} from "lucide-react";

export type ServiceScopeStatus = "GREEN" | "AMBER" | "RED";

export type ServiceScopeItem = {
  slug: string;
  status: ServiceScopeStatus;
  name: string;
  shortName: string;
  headline: string;
  customerDescription: string;
  examples: string[];
  exclusions: string[];
  aliases: string[];
  ctaMode: "REQUEST" | "ASK_FIRST" | "NOT_SUPPORTED";
  icon: LucideIcon;
};

export const serviceScopeLabels: Record<
  ServiceScopeStatus,
  { label: string; summary: string; toneClass: string }
> = {
  GREEN: {
    label: "Green",
    summary: "Ready for WhatsApp-first MVP requests.",
    toneClass: "border-[color:var(--accent-green-wa)]/35 bg-[color:var(--accent-green-wa)]/8",
  },
  AMBER: {
    label: "Amber",
    summary: "Ask first. Support may limit scope before matching.",
    toneClass: "border-amber-500/35 bg-amber-500/8",
  },
  RED: {
    label: "Red",
    summary: "Not handled in the MVP launch scope.",
    toneClass: "border-red-500/35 bg-red-500/8",
  },
};

export const serviceScopeMatrix: ServiceScopeItem[] = [
  {
    slug: "general-home-repairs",
    status: "GREEN",
    name: "General Home Repairs",
    shortName: "Home repairs",
    headline: "Small repairs and everyday home maintenance tasks",
    customerDescription:
      "Good for defined home jobs where the scope can be described, quoted and completed without major site work.",
    examples: [
      "Door handles, hinges and small fixtures",
      "Shelves, curtain rails and mounting tasks",
      "Minor plaster, grout and tile touch-ups",
      "Flat-pack furniture assembly",
    ],
    exclusions: [
      "Major structural changes",
      "Unsafe heights or specialist equipment",
      "Jobs that need a formal site plan",
    ],
    aliases: ["handyman", "home maintenance", "minor repair", "odd jobs", "small fix"],
    ctaMode: "REQUEST",
    icon: Hammer,
  },
  {
    slug: "room-painting",
    status: "GREEN",
    name: "Room Painting and Touch-Ups",
    shortName: "Painting",
    headline: "Rooms, touch-ups and small paint jobs",
    customerDescription:
      "Use Plug A Pro for defined paint jobs where the provider can quote the room, wall or touch-up area in writing.",
    examples: [
      "Single-room repainting",
      "Feature wall painting",
      "Touch-ups after small repairs",
      "Boundary wall or gate painting where safe",
    ],
    exclusions: [
      "Large multi-week paint projects",
      "High-rise exterior painting",
      "Specialist coatings that need certified handling",
    ],
    aliases: ["painting", "paint", "room painting", "wall painting", "touch up"],
    ctaMode: "REQUEST",
    icon: Brush,
  },
  {
    slug: "garden-lawn-care",
    status: "GREEN",
    name: "Garden and Lawn Care",
    shortName: "Garden care",
    headline: "Everyday outdoor clearing and maintenance",
    customerDescription:
      "Suitable for lawn cutting, trimming and manageable garden clean-up that can be quoted before work starts.",
    examples: [
      "Lawn mowing and edging",
      "Weeding and garden clean-up",
      "Hedge trimming",
      "Small planting tasks",
    ],
    exclusions: [
      "Tree felling",
      "Large landscaping redesigns",
      "Jobs needing heavy machinery",
    ],
    aliases: ["garden", "lawn", "mowing", "weeding", "landscaping small"],
    ctaMode: "REQUEST",
    icon: Flower2,
  },
  {
    slug: "tap-repairs",
    status: "AMBER",
    name: "Small Plumbing Jobs",
    shortName: "tap repairs",
    headline: "Leaks, taps, drains and small fittings where safe",
    customerDescription:
      "Plumbing requests are screened first so support can keep the scope to minor, defined work and avoid regulated or high-risk tasks.",
    examples: [
      "Tap and mixer repairs",
      "Toilet cistern parts",
      "Minor leak checks",
      "Shower head replacements",
    ],
    exclusions: [
      "Gas work",
      "Major pipe rerouting",
      "Certificate-of-compliance work",
      "High-risk geyser or electrical-linked work",
    ],
    aliases: ["plumbing", "minor plumbing leak", "tap", "toilet", "blocked drain", "leak"],
    ctaMode: "ASK_FIRST",
    icon: ShowerHead,
  },
  {
    slug: "appliance-checks",
    status: "AMBER",
    name: "Appliance Checks",
    shortName: "Appliance checks",
    headline: "Basic fault checks and small appliance repairs",
    customerDescription:
      "Appliance requests are screened because some jobs need specialist parts, manufacturer support or electrical safety handling.",
    examples: [
      "Washing machine not draining",
      "Fridge fault assessment",
      "Oven element checks",
      "Dishwasher seal or door issues",
    ],
    exclusions: [
      "Warranty claims",
      "Internal electrical rewiring",
      "Industrial appliances",
    ],
    aliases: ["appliance", "washing machine", "fridge", "oven", "dishwasher"],
    ctaMode: "ASK_FIRST",
    icon: Wrench,
  },
  {
    slug: "regulated-electrical",
    status: "RED",
    name: "Regulated Electrical Work",
    shortName: "Electrical work",
    headline: "Not handled in the WhatsApp-first MVP",
    customerDescription:
      "The MVP does not route electrical work that can create safety, compliance or credential risk.",
    examples: [
      "Distribution board work",
      "New plug points or wiring",
      "Electrical fault tracing in walls",
    ],
    exclusions: [
      "All regulated electrical work is excluded from MVP matching",
      "Use an appropriately qualified provider outside this MVP flow",
    ],
    aliases: ["electrical", "electrician", "wiring", "plug point", "db board"],
    ctaMode: "NOT_SUPPORTED",
    icon: PlugZap,
  },
  {
    slug: "renovations",
    status: "RED",
    name: "Large Builds and Remodels",
    shortName: "Large builds",
    headline: "Not part of the small-job MVP scope",
    customerDescription:
      "Plug A Pro’s launch scope is small everyday jobs, not major multi-trade projects or ongoing site work.",
    examples: [
      "Room remodels",
      "New building work",
      "Multi-week site projects",
    ],
    exclusions: [
      "Major remodels are excluded",
      "New building work is excluded",
      "Long-running site teams are excluded",
    ],
    aliases: ["renovations", "renovation", "construction", "new building construction", "building project"],
    ctaMode: "NOT_SUPPORTED",
    icon: Home,
  },
  {
    slug: "high-risk-site-work",
    status: "RED",
    name: "High-Risk Site Work",
    shortName: "High-risk work",
    headline: "Excluded until operations can support it",
    customerDescription:
      "The MVP avoids work where safety controls, heavy equipment or specialist credentials are the main requirement.",
    examples: [
      "Working at unsafe heights",
      "Tree felling",
      "Hazardous material handling",
    ],
    exclusions: [
      "Unsafe heights are excluded",
      "Heavy equipment work is excluded",
      "Hazardous material work is excluded",
    ],
    aliases: ["tree felling", "hazardous", "unsafe height", "scaffolding", "heavy equipment"],
    ctaMode: "NOT_SUPPORTED",
    icon: TriangleAlert,
  },
];

export function getServicesByStatus(status: ServiceScopeStatus): ServiceScopeItem[] {
  return serviceScopeMatrix.filter((service) => service.status === status);
}

export function getServiceScopeBySlug(slug: string): ServiceScopeItem {
  const service = serviceScopeMatrix.find((item) => item.slug === slug);

  if (!service) {
    throw new Error(`Unknown service scope slug: ${slug}`);
  }

  return service;
}
