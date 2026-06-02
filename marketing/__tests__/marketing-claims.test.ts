import { describe, expect, it } from "vitest";
import { forbiddenPublicClaimTerms } from "@/content/marketing/banned-copy";
import {
  publicMarketingContentFiles,
  scanForbiddenClaimsInFiles,
  scanTextForForbiddenClaims,
} from "@/lib/marketing/claimGuard";

describe("marketing claim guard", () => {
  it("flags forbidden public claims in text", () => {
    const findings = scanTextForForbiddenClaims(
      "Meet a verified pro with instant booking and guaranteed workmanship.",
      "inline-test",
    );

    expect(findings.map((finding) => finding.term)).toEqual(
      expect.arrayContaining(["verified pro", "instant booking", "guaranteed workmanship"]),
    );
  });

  it("keeps the forbidden phrase list reusable", () => {
    expect(forbiddenPublicClaimTerms).toEqual(
      expect.arrayContaining(["verified profile", "fixed price", "worker"]),
    );
  });

  it("keeps public marketing content free of forbidden claims", async () => {
    const findings = await scanForbiddenClaimsInFiles(publicMarketingContentFiles);

    expect(findings).toEqual([]);
  });

  it("scans public route and component copy, not only content modules", () => {
    expect(publicMarketingContentFiles).toEqual(
      expect.arrayContaining([
        "app/(marketing)/terms/page.tsx",
        "app/(marketing)/trust/page.tsx",
        "components/marketing/CTAStrip.tsx",
        "components/services/ServiceScopeCard.tsx",
      ]),
    );
  });
});
