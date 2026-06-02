import type { ForbiddenPublicClaimTerm } from "./banned-copy";
import { forbiddenPublicClaimTerms } from "./banned-copy";

export const claimRiskLevels = ["APPROVED", "CONDITIONAL", "FORBIDDEN"] as const;

export type ClaimRiskLevel = (typeof claimRiskLevels)[number];

export type MarketingClaim = {
  term: string;
  level: ClaimRiskLevel;
  replacement?: string;
  allowedContext: "public" | "conditional" | "internal-only";
  note: string;
};

export const approvedPublicClaims: MarketingClaim[] = [
  "local pro",
  "service provider",
  "local service provider",
  "skilled local provider",
  "small job",
  "home job",
  "everyday fix",
  "minor repair",
  "home maintenance task",
  "written quote",
  "quote approval",
  "WhatsApp updates",
  "job record",
  "before and after photos",
  "eligibility-reviewed",
  "application-reviewed",
  "profile reviewed",
  "approved for marketplace access",
].map((term) => ({
  term,
  level: "APPROVED",
  allowedContext: "public",
  note: "Safe for launch copy because it describes the platform flow without overstating assurance.",
}));

export const conditionalPublicClaims: MarketingClaim[] = [
  {
    term: "identity check",
    level: "CONDITIONAL",
    allowedContext: "conditional",
    note: "Use only when the page names the specific check and avoids implying broad assurance.",
  },
  {
    term: "credentials supplied",
    level: "CONDITIONAL",
    allowedContext: "conditional",
    note: "Use only for provider-supplied information or a specifically reviewed field.",
  },
  {
    term: "support review",
    level: "CONDITIONAL",
    allowedContext: "conditional",
    note: "Use only for the dispute or escalation workflow, not as a service outcome promise.",
  },
];

export const forbiddenPublicClaims: MarketingClaim[] = forbiddenPublicClaimTerms.map(
  (term: ForbiddenPublicClaimTerm) => ({
    term,
    level: "FORBIDDEN",
    replacement:
      term === "verified profile"
        ? "profile reviewed"
        : term.includes("verified")
          ? "application-reviewed"
          : undefined,
    allowedContext: "internal-only",
    note:
      "Forbidden in public launch copy because it can overstate marketplace checks or misdescribe the provider relationship.",
  }),
);

export const marketingClaimTaxonomy = [
  ...approvedPublicClaims,
  ...conditionalPublicClaims,
  ...forbiddenPublicClaims,
] as const;

export function getClaimForTerm(term: string): MarketingClaim | undefined {
  const normalized = term.trim().toLowerCase();

  return marketingClaimTaxonomy.find((claim) => claim.term.toLowerCase() === normalized);
}
