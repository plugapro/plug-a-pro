import { serviceScopeMatrix } from "@/content/services/service-scope";

export type PilotArea = {
  slug: string;
  name: string;
  province: string;
  intro: string;
  suburbs: string[];
};

// Pilot launch areas drive the /areas/[citySlug] and /areas/[citySlug]/[serviceSlug]
// SEO landing pages. Keep the list small until WhatsApp dispatch can actually
// route requests for each city; new areas should only be added once operations
// can support a same-day response there.
export const PILOT_AREAS: PilotArea[] = [
  {
    slug: "johannesburg",
    name: "Johannesburg",
    province: "Gauteng",
    intro:
      "Plug A Pro connects Johannesburg households with independent local providers across painting, handyman tasks, garden care and small plumbing checks. Requests are quoted on WhatsApp during business hours so you can review the scope before any work starts.",
    suburbs: [
      "Sandton",
      "Randburg",
      "Roodepoort",
      "Soweto",
      "Rosebank",
      "Fourways",
    ],
  },
  {
    slug: "cape-town",
    name: "Cape Town",
    province: "Western Cape",
    intro:
      "In Cape Town, Plug A Pro helps you describe a small home job and matches you with an independent local provider for painting, garden clean-ups, handyman fixes and minor plumbing. Quotes come in writing on WhatsApp so there are no surprise charges after the job.",
    suburbs: [
      "Sea Point",
      "Claremont",
      "Bellville",
      "Mitchells Plain",
      "Observatory",
      "Pinelands",
    ],
  },
  {
    slug: "pretoria",
    name: "Pretoria",
    province: "Gauteng",
    intro:
      "Pretoria households use Plug A Pro for small everyday jobs from a touch-up paint to a leaky tap or weekend garden tidy. The conversation starts on WhatsApp so the local provider can scope the job and quote it in writing before they arrive on site.",
    suburbs: [
      "Hatfield",
      "Centurion",
      "Brooklyn",
      "Menlyn",
      "Arcadia",
      "Mamelodi",
    ],
  },
];

export const PILOT_AREA_SLUGS = PILOT_AREAS.map((area) => area.slug);

export function getAreaBySlug(slug: string): PilotArea | null {
  return PILOT_AREAS.find((area) => area.slug === slug) ?? null;
}

export type AreaServicePair = {
  citySlug: string;
  serviceSlug: string;
};

// Cross-product of pilot areas and bookable services. ctaMode === "REQUEST"
// is the marker for services that can actually be requested through the
// WhatsApp-first MVP; AMBER and RED services are excluded because operations
// either screens them first (AMBER) or does not handle them at all (RED).
export function getAreaServiceLandingPairs(): AreaServicePair[] {
  const bookable = serviceScopeMatrix.filter(
    (service) => service.ctaMode === "REQUEST",
  );

  return PILOT_AREAS.flatMap((area) =>
    bookable.map((service) => ({
      citySlug: area.slug,
      serviceSlug: service.slug,
    })),
  );
}
