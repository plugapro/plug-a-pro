import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getProviderRegistrationUrl } from "@/lib/provider-registration-url";

const root = process.cwd();
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

function readSource(filePath: string): string {
  return readFileSync(join(root, filePath), "utf8");
}

describe("provider registration CTAs", () => {
  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  });

  it("builds the canonical provider registration app URL from getAppUrl", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://preview-app.example.com";

    expect(getProviderRegistrationUrl()).toBe("https://preview-app.example.com/provider/register");
  });

  it("exposes provider registration CTAs across marketing entry points", () => {
    const nav = readSource("components/shared/Nav.tsx");
    const hero = readSource("components/marketing/Hero.tsx");
    const providerStory = readSource("components/marketing/ProviderStorySection.tsx");
    const providerPage = readSource("app/(marketing)/for-providers/page.tsx");
    const footer = readSource("components/shared/Footer.tsx");

    expect(nav).toContain("Join as a Provider");
    expect(nav).toContain("Register as a Service Provider");
    expect(nav).toContain("nav_desktop_provider_register");
    expect(nav).toContain("nav_mobile_provider_register");
    expect(hero).toContain("hero_provider_register");
    expect(providerStory).toContain("provider_story_register");
    expect(providerPage).toContain("for_providers_primary_register");
    expect(providerPage).toContain("for_providers_eligibility_register");
    expect(footer).toContain("For Service Providers");
    expect(footer).toContain("footer_provider_register");
  });

  it("keeps provider CTAs on the PWA registration route while preserving WhatsApp support", () => {
    const files = [
      "components/shared/Nav.tsx",
      "components/marketing/Hero.tsx",
      "components/marketing/ProviderStorySection.tsx",
      "app/(marketing)/for-providers/page.tsx",
      "components/shared/Footer.tsx",
    ];

    for (const file of files) {
      expect(readSource(file)).toContain("ProviderRegistrationCta");
    }

    expect(readSource("app/(marketing)/for-providers/page.tsx")).toContain("WhatsAppCtaButton");
  });

  it("keeps the provider registration link compatible with composed mobile menu controls", () => {
    const source = readSource("components/marketing/ProviderRegistrationCta.tsx");

    expect(source).toContain("forwardRef<HTMLAnchorElement");
    expect(source).toContain("...props");
    expect(source).toContain("ref={ref}");
    expect(source).toContain("onClick?.(event)");
  });
});
