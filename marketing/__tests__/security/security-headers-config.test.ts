import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("marketing security headers", () => {
  it("configures CSP and HSTS", () => {
    const source = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

    expect(source).toContain("Content-Security-Policy");
    expect(source).toContain("Strict-Transport-Security");
  });
});
