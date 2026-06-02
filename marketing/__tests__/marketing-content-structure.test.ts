import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const publicRenderingFiles = [
  "app/(marketing)/for-providers/page.tsx",
  "app/(marketing)/how-it-works/page.tsx",
  "app/(marketing)/services/page.tsx",
  "app/(marketing)/services/[slug]/page.tsx",
  "app/(marketing)/trust/page.tsx",
  "components/services/ServiceScopeCard.tsx",
] as const;

const controlledPublicCopy = [
  "Start provider onboarding",
  "See MVP service scope",
  "What the provider journey gives you",
  "How to join",
  "Who can apply",
  "MVP service scope",
  "Small everyday jobs only.",
  "View trust process",
  "Not sure where your job fits?",
  "Back to services",
  "How this job starts",
  "View supported jobs",
  "Start this request",
  "Trust pack",
  "What Plug A Pro is not",
  "Request on WhatsApp",
  "Ask if this fits",
  "View details",
  "View scope",
  "Start provider onboarding on WhatsApp",
  "How Plug A Pro works",
  "The short version",
] as const;

describe("marketing content structure", () => {
  it("keeps launch-critical page copy in content modules instead of render files", async () => {
    const findings: Array<{ filePath: string; copy: string }> = [];

    for (const filePath of publicRenderingFiles) {
      // Route and component files should render imported launch copy, not own it.
      const text = await readFile(join(process.cwd(), filePath), "utf8");

      for (const copy of controlledPublicCopy) {
        if (text.includes(copy)) {
          findings.push({ filePath, copy });
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
