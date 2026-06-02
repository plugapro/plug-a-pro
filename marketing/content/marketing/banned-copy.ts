// Public claim guardrail terms. Internal taxonomy files may name these phrases
// so reviewers can see exactly what must not leak into launch copy.
export const forbiddenPublicClaimTerms = [
  "verified pro",
  "verified provider",
  "verified profile",
  "fully verified",
  "vetted",
  "guaranteed",
  "guaranteed workmanship",
  "fixed price",
  "instant booking",
  "on-demand",
  "AI-powered",
  "contractor",
  "worker",
  "gig",
  "job seeker",
  "unlimited earnings",
  "earn more",
] as const;

export type ForbiddenPublicClaimTerm = (typeof forbiddenPublicClaimTerms)[number];

// These files define the policy itself, so the scanner deliberately excludes
// them while still scanning every reusable public content module.
export const claimGuardInternalFiles = [
  "content/marketing/claim-taxonomy.ts",
  "content/marketing/banned-copy.ts",
] as const;
