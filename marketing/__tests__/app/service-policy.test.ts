import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scanTextForForbiddenClaims } from "@/lib/marketing/claimGuard";

const PAGE_PATH = "app/(marketing)/service-policy/page.tsx";

async function pageSource(): Promise<string> {
  // The claim guard scans route files the same way; vitest runs with cwd = marketing/.
  return readFile(join(process.cwd(), PAGE_PATH), "utf8");
}

describe("service-policy coverage copy", () => {
  it("states national coverage in the exact approved wording", async () => {
    const src = await pageSource();
    expect(src).toContain("Plug A Pro operates across South Africa.");
    expect(src).toContain(
      "Availability depends on independent providers near you; where we have none yet, you can ask to be notified the moment one joins.",
    );
  });

  it("no longer names a single launch area or the waitlist", async () => {
    const src = await pageSource();
    expect(src).not.toMatch(/Johannesburg West|Roodepoort|currently serves|waitlist/);
  });

  it("keeps the link to the service-areas landing page", async () => {
    const src = await pageSource();
    expect(src).toContain('<Link href="/areas/johannesburg">service areas</Link>');
  });

  it("passes the public claim guard", async () => {
    const src = await pageSource();
    expect(scanTextForForbiddenClaims(src, PAGE_PATH)).toEqual([]);
  });
});
