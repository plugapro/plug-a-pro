import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "@/lib/chat-context";

describe("buildChatSystemPrompt", () => {
  it("returns a non-empty string", async () => {
    const prompt = await buildChatSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes the product name", async () => {
    const prompt = await buildChatSystemPrompt();
    expect(prompt).toContain("Plug-A-Pro");
  });

  it("includes FAQ section", async () => {
    const prompt = await buildChatSystemPrompt();
    expect(prompt.toLowerCase()).toContain("faq");
  });
});
