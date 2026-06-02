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
