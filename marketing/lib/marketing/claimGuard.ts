import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  claimGuardInternalFiles,
  forbiddenPublicClaimTerms,
  type ForbiddenPublicClaimTerm,
} from "@/content/marketing/banned-copy";

export type ClaimFinding = {
  filePath: string;
  term: ForbiddenPublicClaimTerm;
  index: number;
  excerpt: string;
};

export const publicMarketingContentFiles = [
  // Scan rendered route files because legacy public copy often lives directly
  // in pages while we migrate the site toward reusable content modules.
  "app/(marketing)/page.tsx",
  "app/(marketing)/about/page.tsx",
  "app/(marketing)/credits-policy/page.tsx",
  "app/(marketing)/faq/page.tsx",
  "app/(marketing)/features/page.tsx",
  "app/(marketing)/for-customers/page.tsx",
  "app/(marketing)/for-providers/page.tsx",
  "app/(marketing)/for-workers/page.tsx",
  "app/(marketing)/how-it-works/page.tsx",
  "app/(marketing)/pricing/page.tsx",
  "app/(marketing)/privacy/page.tsx",
  "app/(marketing)/services/page.tsx",
  "app/(marketing)/services/[slug]/page.tsx",
  "app/(marketing)/solutions/page.tsx",
  "app/(marketing)/terms/page.tsx",
  "app/(marketing)/trust/page.tsx",
  // Scan the visible marketing components that compose the public launch pages.
  "components/marketing/CTAStrip.tsx",
  "components/marketing/Features.tsx",
  "components/marketing/Hero.tsx",
  "components/marketing/HowItWorksSteps.tsx",
  "components/marketing/LeadMagnetForm.tsx",
  "components/marketing/OnboardingForm.tsx",
  "components/marketing/OperatingModel.tsx",
  "components/marketing/PricingCards.tsx",
  "components/marketing/ProviderStorySection.tsx",
  "components/marketing/SocialProof.tsx",
  "components/marketing/TrustSafety.tsx",
  "components/marketing/WhoItsFor.tsx",
  "components/services/ServiceScopeCard.tsx",
  // Scan reusable public content modules so future copy changes are guarded
  // before they are imported into pages.
  "content/marketing/homepage.ts",
  "content/marketing/provider.ts",
  "content/marketing/trust.ts",
  "content/marketing/provider-economics.ts",
  "content/marketing/reviews.ts",
  "content/marketing/consent.ts",
  "content/services/service-scope.ts",
] as const;

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function termRegex(term: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])(${escapeRegex(term)})(?=$|[^a-z0-9])`, "gi");
}

function excerptFor(text: string, index: number): string {
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + 90);

  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function scanTextForForbiddenClaims(
  text: string,
  filePath = "inline",
  terms: readonly ForbiddenPublicClaimTerm[] = forbiddenPublicClaimTerms,
): ClaimFinding[] {
  return terms.flatMap((term) => {
    const matches = [...text.matchAll(termRegex(term))];

    return matches.map((match) => {
      const index = match.index ?? 0;

      return {
        filePath,
        term,
        index,
        excerpt: excerptFor(text, index),
      };
    });
  });
}

export async function scanForbiddenClaimsInFiles(
  files: readonly string[],
): Promise<ClaimFinding[]> {
  const internal = new Set<string>(claimGuardInternalFiles);
  const findings: ClaimFinding[] = [];

  for (const filePath of files) {
    if (internal.has(filePath)) continue;

    const text = await readFile(join(process.cwd(), filePath), "utf8");
    findings.push(...scanTextForForbiddenClaims(text, filePath));
  }

  return findings;
}
