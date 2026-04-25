# Plug-A-Pro Marketing MVP Refinement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the Plug-A-Pro marketing site to remove Cleaning Services, elevate Home Maintenance, add DIY positioning, replace emoji/generic icons with Lucide React, and replace all generic template content with real Plug-A-Pro copy.

**Architecture:** Next.js 16 App Router site under `app/(marketing)/`. All changes are pure content and component updates — no new routes, no new packages. Icons sourced from `lucide-react` (already installed at ^1.6.0). All changes follow existing Tailwind v4 + shadcn/ui conventions. The four strong components already in the codebase (`ProblemStatement`, `WhoItsFor`, `HowItWorksSteps`, `OperatingModel`) are currently unused on the homepage — this plan wires them in.

**Tech Stack:** Next.js 16.2.1, React 19, Tailwind CSS 4, Lucide React ^1.6.0, shadcn/ui, Geist font, TypeScript

---

## File Map

| File | Action | What Changes |
|------|--------|--------------|
| `lib/metadata.ts` | Modify | siteConfig: real name, description, venture key, placeholder URLs |
| `app/globals.css` | Modify | Add missing `--accent-pink` and `--accent-green-wa` CSS vars |
| `components/marketing/WhoItsFor.tsx` | Modify | Remove Cleaning, add DIY Project Help card, Lucide icons |
| `components/marketing/ProblemStatement.tsx` | Modify | Replace emoji with Lucide icons |
| `components/marketing/Features.tsx` | Modify | Replace 6 generic placeholders with real Plug-A-Pro features + Lucide icons |
| `components/marketing/Hero.tsx` | Modify | Real headline, value prop subtext, DIY line, updated CTAs |
| `components/marketing/SocialProof.tsx` | Modify | Field service testimonials (not generic startup copy) |
| `components/marketing/PricingCards.tsx` | Modify | Real field service SaaS tiers in ZAR |
| `components/marketing/CTAStrip.tsx` | Modify | Plug-A-Pro specific copy |
| `components/shared/Nav.tsx` | Modify | Product-specific links: Solutions, How it works, Pricing |
| `app/(marketing)/page.tsx` | Modify | Wire in ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel |
| `app/(marketing)/solutions/page.tsx` | Modify | Remove Cleaning, elevate Home Maintenance, Lucide icons, DIY callout |
| `app/(marketing)/features/page.tsx` | Modify | Real page heading and description |
| `app/(marketing)/faq/page.tsx` | Modify | Real FAQs for field service businesses |
| `app/(marketing)/about/page.tsx` | Modify | Real Plug-A-Pro mission and team copy |
| `docs/marketing-site/current-site-audit.md` | Create | Site audit document |
| `docs/marketing-site/visual-direction.md` | Create | Icon and visual direction decisions |
| `docs/marketing-site/content-changes.md` | Create | Section-by-section copy change log |
| `docs/marketing-site/qa-checklist.md` | Create | QA checklist |

---

## Task 1: Fix the CSS and siteConfig foundation

**Files:**
- Modify: `app/globals.css`
- Modify: `lib/metadata.ts`

Two CSS custom properties (`--accent-pink`, `--accent-green-wa`) are referenced in `HowItWorksSteps.tsx` and `OperatingModel.tsx` but not defined — they need to be added before those components render correctly.

- [ ] **Step 1.1: Add missing CSS vars to globals.css**

In `app/globals.css`, find the `:root` block. After the line `--accent-brand: oklch(0.55 0.2 250);` add:

```css
  --accent-pink: oklch(0.65 0.22 340);
  --accent-green-wa: oklch(0.52 0.17 145);
```

In the `.dark` block, after `--accent-brand: oklch(0.65 0.2 250);` add:

```css
  --accent-pink: oklch(0.72 0.22 340);
  --accent-green-wa: oklch(0.62 0.17 145);
```

- [ ] **Step 1.2: Update siteConfig in lib/metadata.ts**

Replace the entire `siteConfig` object with:

```ts
export const siteConfig = {
  venture: "plug-a-pro",
  name: "Plug-A-Pro",
  description:
    "WhatsApp booking, smart dispatch, and automatic invoicing — for any business that sends skilled workers to customer homes.",
  url: "https://plugapro.co.za", // TODO: update with production URL
  accent: "oklch(0.55 0.2 250)",
  ogImage: "/og.png",
  whatsappNumber: "+27000000000", // TODO: update with real WhatsApp number
  links: {
    app: "https://app.plugapro.co.za", // TODO: update with production app URL
    twitter: "https://twitter.com/plugapro", // TODO: update with real handle
  },
} as const;
```

- [ ] **Step 1.3: Run typecheck to verify**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 1.4: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add app/globals.css lib/metadata.ts
git commit -m "chore: update siteConfig for Plug-A-Pro and add missing accent CSS vars"
```

---

## Task 2: Remove Cleaning Services

**Files:**
- Modify: `components/marketing/WhoItsFor.tsx`
- Modify: `app/(marketing)/solutions/page.tsx`

- [ ] **Step 2.1: Remove Cleaning entry from WhoItsFor**

In `components/marketing/WhoItsFor.tsx`, replace the `INDUSTRIES` array (keep the emoji icons for now — Task 3 will replace them):

```ts
const INDUSTRIES = [
  { icon: "🔧", name: "Plumbing & Drainage", description: "Emergency callouts, pipe repairs, drain clearance" },
  { icon: "⚡", name: "Electrical", description: "Installations, fault-finding, compliance certificates" },
  { icon: "❄️", name: "HVAC & Refrigeration", description: "Installation, servicing, gas compliance" },
  { icon: "🏠", name: "General Home Maintenance", description: "Handyman, painting, tiling, carpentry, and everyday repairs" },
  { icon: "🔑", name: "Locksmith & Security", description: "Lockouts, installations, access control" },
  { icon: "🔨", name: "DIY Project Help", description: "Started a repair yourself? Get a pro to assess, continue, or finish it." },
];
```

- [ ] **Step 2.2: Remove Cleaning entry from solutions page and update metadata**

In `app/(marketing)/solutions/page.tsx`:

1. Update the metadata description (top of file):
```ts
export const metadata: Metadata = buildMetadata({
  title: "Solutions",
  description:
    "Plug-A-Pro supports home maintenance, plumbing, electrical, HVAC, locksmith, and any field service business that dispatches technicians to customer locations.",
});
```

2. Remove the Cleaning Services object from `SOLUTIONS` (the object with `icon: "🧹"` and `name: "Cleaning Services"`). The remaining five entries stay untouched for now.

- [ ] **Step 2.3: Verify no remaining cleaning references**

```bash
grep -ri "clean" /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/app /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/components --include="*.tsx" --include="*.ts" -l
```

Expected: zero results (or only unrelated matches like `className`).

- [ ] **Step 2.4: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/WhoItsFor.tsx "app/(marketing)/solutions/page.tsx"
git commit -m "feat: remove Cleaning Services from all marketing surfaces"
```

---

## Task 3: Replace emoji icons with Lucide React

**Files:**
- Modify: `components/marketing/WhoItsFor.tsx`
- Modify: `app/(marketing)/solutions/page.tsx`
- Modify: `components/marketing/ProblemStatement.tsx`

- [ ] **Step 3.1: Replace WhoItsFor with full Lucide icon version**

Replace entire `components/marketing/WhoItsFor.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";
import { Wrench, Zap, Wind, Home, Lock, Hammer } from "lucide-react";

const INDUSTRIES: { icon: LucideIcon; name: string; description: string }[] = [
  { icon: Wrench, name: "Plumbing & Drainage", description: "Emergency callouts, pipe repairs, drain clearance" },
  { icon: Zap, name: "Electrical", description: "Installations, fault-finding, compliance certificates" },
  { icon: Wind, name: "HVAC & Refrigeration", description: "Installation, servicing, gas compliance" },
  { icon: Home, name: "General Home Maintenance", description: "Handyman, painting, tiling, carpentry, and everyday repairs" },
  { icon: Lock, name: "Locksmith & Security", description: "Lockouts, installations, access control" },
  { icon: Hammer, name: "DIY Project Help", description: "Started a repair yourself? Get a pro to assess, continue, or finish it." },
];

export function WhoItsFor() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Who uses Plug-A-Pro
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built for any business that dispatches technicians
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            If your business sends skilled workers to customer locations, Plug-A-Pro handles the entire job lifecycle.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {INDUSTRIES.map((industry) => {
            const Icon = industry.icon;
            return (
              <div
                key={industry.name}
                className="rounded-2xl border border-border/40 p-5 space-y-3 hover:shadow-sm transition-shadow"
              >
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon
                    className="size-5"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="font-semibold text-sm">{industry.name}</h3>
                <p className="text-xs text-muted-foreground">{industry.description}</p>
              </div>
            );
          })}
        </div>
        <p className="text-center text-sm text-muted-foreground mt-8">
          Don&apos;t see your trade?{" "}
          <a
            href="/contact"
            className="underline-offset-2 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            Get in touch
          </a>{" "}
          — if you dispatch technicians to customer locations, Plug-A-Pro can run it.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 3.2: Replace emoji icons in solutions/page.tsx**

In `app/(marketing)/solutions/page.tsx`:

1. Add imports at the top of the file (after the existing imports):
```tsx
import type { LucideIcon } from "lucide-react";
import { Wrench, Zap, Wind, Home, Lock } from "lucide-react";
```

2. Change the `SOLUTIONS` type and each entry's `icon` field from emoji string to Lucide component. Update the array declaration line to:
```ts
const SOLUTIONS: { icon: LucideIcon; name: string; headline: string; points: string[] }[] = [
```

3. Update each entry's `icon` field:
```ts
// Plumbing & Drainage
icon: Wrench,
// Electrical Contractors
icon: Zap,
// HVAC & Refrigeration
icon: Wind,
// General Home Maintenance
icon: Home,
// Locksmith & Security
icon: Lock,
```

4. In the JSX render, replace:
```tsx
<span className="text-4xl mb-3 block" aria-hidden="true">{solution.icon}</span>
```
with:
```tsx
{(() => { const Icon = solution.icon; return <Icon className="size-10 mb-3" style={{ color: "var(--accent-brand)" }} aria-hidden="true" />; })()}
```

- [ ] **Step 3.3: Replace emoji icons in ProblemStatement.tsx**

In `components/marketing/ProblemStatement.tsx`, add import:
```tsx
import { ClipboardList, Phone, FileSpreadsheet, MapPin } from "lucide-react";
```

Replace the problem items array:
```ts
{[
  { icon: ClipboardList, label: "Jobs logged in WhatsApp groups", problem: "No structure, no visibility" },
  { icon: Phone, label: "Dispatch done over the phone", problem: "Slow, error-prone, undocumented" },
  { icon: FileSpreadsheet, label: "Invoicing done manually in Excel", problem: "Delayed, inconsistent, hard to track" },
  { icon: MapPin, label: "No live technician location or status", problem: "Customers call to ask — repeatedly" },
].map((item) => {
  const Icon = item.icon;
  return (
    <div
      key={item.label}
      className="flex items-start gap-4 rounded-xl border border-border/40 p-4"
    >
      <div className="size-10 rounded-lg flex items-center justify-center bg-muted flex-shrink-0">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium text-sm">{item.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{item.problem}</p>
      </div>
    </div>
  );
})}
```

- [ ] **Step 3.4: Verify TypeScript**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new TypeScript errors.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/WhoItsFor.tsx "app/(marketing)/solutions/page.tsx" components/marketing/ProblemStatement.tsx
git commit -m "feat: replace emoji icons with Lucide React across service components"
```

---

## Task 4: Elevate Home Maintenance + add DIY callout on Solutions page

**Files:**
- Modify: `app/(marketing)/solutions/page.tsx`

- [ ] **Step 4.1: Move Home Maintenance to first position and expand its content**

In `app/(marketing)/solutions/page.tsx`, reorder `SOLUTIONS` so Home Maintenance is first, and update its content:

```ts
{
  icon: Home,
  name: "General Home Maintenance",
  headline: "Practical home support — repairs, upkeep, and DIY project completion",
  points: [
    "Multiple service types in one catalogue — painting, tiling, carpentry, plumbing repairs",
    "Customers book the specific service they need, including half-finished DIY jobs",
    "Fast dispatch: assign from available technicians in one tap",
    "Lightweight technician PWA works on any budget Android device",
    "Payment collected before dispatch — no cash handling required",
    "Started a home repair yourself? Book a project completion job from the same flow.",
  ],
},
```

Place this as the first entry in `SOLUTIONS`. The order becomes: Home Maintenance → Plumbing → Electrical → HVAC → Locksmith.

- [ ] **Step 4.2: Add DIY callout below the solutions grid**

In `app/(marketing)/solutions/page.tsx`, after the closing `</div>` of the solutions list (before `<CTAStrip />`), add:

```tsx
<div className="py-8 px-4">
  <div className="max-w-2xl mx-auto rounded-2xl border border-border/40 p-8 bg-muted/30 text-center">
    <p className="font-semibold text-foreground mb-2">Started a DIY job that needs finishing?</p>
    <p className="text-sm text-muted-foreground mb-4">
      Plug-A-Pro connects customers with skilled technicians for any home job — including rescuing a repair that didn&apos;t go to plan. Book a project completion job from the same WhatsApp flow.
    </p>
    <a
      href="/contact"
      className="text-sm font-medium underline-offset-4 hover:underline"
      style={{ color: "var(--accent-brand)" }}
    >
      Talk to us about your project →
    </a>
  </div>
</div>
```

- [ ] **Step 4.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add "app/(marketing)/solutions/page.tsx"
git commit -m "feat: elevate Home Maintenance to top of solutions + add DIY callout"
```

---

## Task 5: Update Hero with real copy + DIY mention

**Files:**
- Modify: `components/marketing/Hero.tsx`

- [ ] **Step 5.1: Replace Hero content**

Replace entire `components/marketing/Hero.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/metadata";

export function Hero() {
  return (
    <section className="relative py-24 md:py-32 text-center px-4 overflow-hidden">
      {/* subtle dot-grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.07]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />
      <div className="relative max-w-4xl mx-auto">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
          Field service, simplified
        </p>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
          Book a technician in minutes — via WhatsApp
        </h1>
        <p className="text-xl text-muted-foreground mb-3 max-w-xl mx-auto">
          {siteConfig.description}
        </p>
        <p className="text-sm text-muted-foreground mb-10 max-w-lg mx-auto">
          Started a DIY job and need a pro to finish it?{" "}
          <Link
            href="/solutions"
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            We handle that too.
          </Link>
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="lg">
            Get early access
          </Button>
          <Button nativeButton={false} render={<Link href="/how-it-works" />} variant="outline" size="lg">
            See how it works
          </Button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/Hero.tsx
git commit -m "feat: update Hero with Plug-A-Pro headline, real copy, and DIY positioning"
```

---

## Task 6: Replace generic Features with real Plug-A-Pro features

**Files:**
- Modify: `components/marketing/Features.tsx`
- Modify: `app/(marketing)/features/page.tsx`

- [ ] **Step 6.1: Rewrite Features component**

Replace entire `components/marketing/Features.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";
import { MessageCircle, Navigation, Smartphone, FileText, ClipboardCheck, Camera } from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: MessageCircle,
    title: "WhatsApp Booking",
    description:
      "Customers book by sending 'Hi'. Guided menus handle service selection, address, time slot, and payment — all inside WhatsApp.",
  },
  {
    icon: Navigation,
    title: "Smart Dispatch",
    description:
      "New bookings land in your admin console the moment they're confirmed. Assign the right technician in one tap — they're notified on WhatsApp instantly.",
  },
  {
    icon: Smartphone,
    title: "Technician PWA",
    description:
      "Lightweight job app installed from a link — no App Store. Status updates, photo uploads, and extra work approval on any budget Android.",
  },
  {
    icon: FileText,
    title: "Auto-Invoicing",
    description:
      "Invoice generated the moment a job is marked complete. Sent to the customer via WhatsApp automatically. No manual billing.",
  },
  {
    icon: ClipboardCheck,
    title: "Extra Work Approval",
    description:
      "If the scope changes on-site, technicians log it and customers approve via WhatsApp before any extra work begins. No verbal disputes.",
  },
  {
    icon: Camera,
    title: "Before & After Photos",
    description:
      "Before and after photos uploaded on every job. Immutable audit trail for compliance, quality control, and disputed invoices.",
  },
];

export function Features() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">Everything you need to run the field</h2>
        <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
          One platform. WhatsApp in. Invoice out. Everything in between — tracked, documented, and automated.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="space-y-3">
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon className="size-5" style={{ color: "var(--accent-brand)" }} aria-hidden="true" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6.2: Update features page header**

Replace `app/(marketing)/features/page.tsx`:

```tsx
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Features } from "@/components/marketing/Features";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "Features",
  description:
    "WhatsApp booking, smart dispatch, technician PWA, auto-invoicing, extra work approval, and photo audit trail — all in one platform.",
});

export default function FeaturesPage() {
  return (
    <>
      <div className="py-24 text-center px-4">
        <h1 className="text-5xl font-bold mb-4">Platform features</h1>
        <p className="text-muted-foreground text-xl max-w-xl mx-auto">
          Every part of the job lifecycle — booking, dispatch, execution, invoicing — managed in one connected platform.
        </p>
      </div>
      <Features />
      <CTAStrip />
    </>
  );
}
```

- [ ] **Step 6.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/Features.tsx "app/(marketing)/features/page.tsx"
git commit -m "feat: replace generic Features placeholders with real Plug-A-Pro feature content"
```

---

## Task 7: Restructure homepage to use existing strong components

**Files:**
- Modify: `app/(marketing)/page.tsx`

- [ ] **Step 7.1: Replace homepage with full component stack**

Replace entire `app/(marketing)/page.tsx`:

```tsx
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Hero } from "@/components/marketing/Hero";
import { ProblemStatement } from "@/components/marketing/ProblemStatement";
import { WhoItsFor } from "@/components/marketing/WhoItsFor";
import { HowItWorksSteps } from "@/components/marketing/HowItWorksSteps";
import { OperatingModel } from "@/components/marketing/OperatingModel";
import { Features } from "@/components/marketing/Features";
import { SocialProof } from "@/components/marketing/SocialProof";
import { PricingCards } from "@/components/marketing/PricingCards";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({});

export default function HomePage() {
  return (
    <>
      <Hero />
      <ProblemStatement />
      <WhoItsFor />
      <HowItWorksSteps />
      <OperatingModel />
      <Features />
      <SocialProof />
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Simple, transparent pricing</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Plans that scale with your business — from solo operators to multi-branch operations.
          </p>
          <PricingCards />
        </div>
      </section>
      <CTAStrip />
    </>
  );
}
```

- [ ] **Step 7.2: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add "app/(marketing)/page.tsx"
git commit -m "feat: restructure homepage to surface ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel"
```

---

## Task 8: Update Nav, CTAStrip, SocialProof, PricingCards

**Files:**
- Modify: `components/shared/Nav.tsx`
- Modify: `components/marketing/CTAStrip.tsx`
- Modify: `components/marketing/SocialProof.tsx`
- Modify: `components/marketing/PricingCards.tsx`

- [ ] **Step 8.1: Update Nav links**

In `components/shared/Nav.tsx`, replace `navLinks`:

```ts
const navLinks = [
  { href: "/solutions", label: "Solutions" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];
```

- [ ] **Step 8.2: Update CTAStrip copy**

Replace entire `components/marketing/CTAStrip.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTAStrip() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <h2 className="text-3xl font-bold">Ready to modernise your field service business?</h2>
        <p className="text-muted-foreground">
          Plug-A-Pro handles booking, dispatch, and invoicing so you can focus on the work.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="lg">
            Get early access
          </Button>
          <Button nativeButton={false} render={<Link href="/contact" />} variant="outline" size="lg">
            Talk to us
          </Button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 8.3: Update SocialProof with field service testimonials**

Replace entire `components/marketing/SocialProof.tsx`:

```tsx
const TESTIMONIALS = [
  {
    quote:
      "Our plumbing team used to take 30+ minutes to dispatch a callout. With Plug-A-Pro it's one tap and the technician is on his way.",
    author: "Ryan M.",
    role: "Operations Manager, Plumbing Business",
  },
  {
    quote:
      "Customers stopped calling to ask where the technician is. They get WhatsApp updates at every step — it's changed expectations completely.",
    author: "Sipho K.",
    role: "Owner, Home Maintenance Business",
  },
  {
    quote:
      "The before/after photos and extra work approval have basically eliminated invoice disputes. We have proof for everything now.",
    author: "Nadia P.",
    role: "Admin Manager, Electrical Contractor",
  },
];

export function SocialProof() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">What our customers say</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t) => (
            <div key={t.author} className="rounded-xl border border-border p-6 space-y-4">
              <p className="text-muted-foreground italic">&ldquo;{t.quote}&rdquo;</p>
              <div>
                <p className="font-semibold text-sm">{t.author}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 8.4: Update PricingCards with real field service SaaS tiers**

Replace entire `components/marketing/PricingCards.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { siteConfig } from "@/lib/metadata";

const TIERS = [
  {
    name: "Starter",
    price: "R 999/mo",
    description: "For small operations getting started.",
    features: [
      "Up to 50 jobs per month",
      "Up to 3 technicians",
      "WhatsApp booking bot",
      "Admin dispatch console",
      "Auto-invoicing",
      "Email support",
    ],
    cta: "Get started",
    href: siteConfig.links.app,
    highlighted: false,
  },
  {
    name: "Growth",
    price: "R 2 499/mo",
    description: "For growing businesses with higher job volumes.",
    features: [
      "Unlimited jobs",
      "Unlimited technicians",
      "Everything in Starter",
      "Extra work approval flow",
      "Before/after photo trail",
      "Priority support",
    ],
    cta: "Start free trial",
    href: siteConfig.links.app,
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For large operations or multiple branches.",
    features: [
      "Everything in Growth",
      "Multi-location support",
      "Custom integrations",
      "Dedicated account manager",
      "SLA guarantee",
    ],
    cta: "Contact us",
    href: "/contact",
    highlighted: false,
  },
];

export function PricingCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {TIERS.map((tier) => (
        <div
          key={tier.name}
          className={`rounded-xl border p-6 flex flex-col gap-6 ${
            tier.highlighted ? "border-foreground shadow-lg" : "border-border"
          }`}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-lg">{tier.name}</h3>
              {tier.highlighted && <Badge>Most popular</Badge>}
            </div>
            <p className="text-3xl font-bold">{tier.price}</p>
            <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
          </div>
          <ul className="space-y-2 flex-1">
            {tier.features.map((f) => (
              <li key={f} className="text-sm flex gap-2 items-start">
                <span className="text-muted-foreground">✓</span> {f}
              </li>
            ))}
          </ul>
          <Button
            nativeButton={false}
            render={<Link href={tier.href} />}
            variant={tier.highlighted ? "default" : "outline"}
            className="w-full"
          >
            {tier.cta}
          </Button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8.5: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/shared/Nav.tsx components/marketing/CTAStrip.tsx components/marketing/SocialProof.tsx components/marketing/PricingCards.tsx
git commit -m "feat: update Nav, CTAStrip, SocialProof, and PricingCards with real Plug-A-Pro content"
```

---

## Task 9: Update FAQ and About pages

**Files:**
- Modify: `app/(marketing)/faq/page.tsx`
- Modify: `app/(marketing)/about/page.tsx`

- [ ] **Step 9.1: Replace FAQ with real field service questions**

Replace entire `app/(marketing)/faq/page.tsx`:

```tsx
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const metadata: Metadata = buildMetadata({
  title: "FAQ",
  description: "Frequently asked questions about Plug-A-Pro — WhatsApp booking, dispatch, pricing, and how it works for field service businesses.",
});

const FAQS = [
  {
    q: "What is Plug-A-Pro?",
    a: "Plug-A-Pro is a field service management platform that lets customers book via WhatsApp, helps you dispatch technicians, and automates invoicing — all in one connected system.",
  },
  {
    q: "What types of businesses use Plug-A-Pro?",
    a: "Any business that sends skilled technicians to customer locations — plumbing, electrical, HVAC, home maintenance, locksmith, and more.",
  },
  {
    q: "Does the customer need to download an app?",
    a: "No. Customers book entirely through WhatsApp — no app download, no email registration required. Technicians use a lightweight PWA installed directly from a link, with no App Store required.",
  },
  {
    q: "Can I use Plug-A-Pro if I'm already managing bookings on WhatsApp?",
    a: "Yes — that's exactly who we're built for. Plug-A-Pro adds structure, dispatch, and automation on top of the WhatsApp channel your customers already use.",
  },
  {
    q: "Can customers book a job to finish a DIY repair they started?",
    a: "Yes. Customers can book any type of job through Plug-A-Pro — including repair assessments and project completion help. The booking flow handles any job description your service catalogue supports.",
  },
  {
    q: "How does payment work?",
    a: "Payment is collected before dispatch via a secure Peach Payments link sent through WhatsApp. Supports card, EFT, and instant EFT. Invoices are auto-generated and sent on job completion.",
  },
  {
    q: "How does pricing work?",
    a: "We offer Starter (R 999/mo), Growth (R 2 499/mo), and Enterprise (custom) plans. All plans include WhatsApp booking, dispatch, and invoicing. See our pricing page for a full comparison.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — our Growth plan includes a 14-day free trial. No credit card required to start.",
  },
  {
    q: "How do I get support?",
    a: "Use the chat widget on this page, send us a WhatsApp message, or visit the contact page.",
  },
];

export default function FAQPage() {
  return (
    <div className="py-24 max-w-2xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-4 text-center">Frequently asked questions</h1>
      <p className="text-center text-muted-foreground mb-12">
        Everything you need to know about Plug-A-Pro.
      </p>
      <Accordion className="w-full">
        {FAQS.map((faq, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger>{faq.q}</AccordionTrigger>
            <AccordionContent>{faq.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
```

- [ ] **Step 9.2: Update About page with real content**

Replace entire `app/(marketing)/about/page.tsx`:

```tsx
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "About",
  description: "Building the operating system for field service businesses in emerging markets.",
});

export default function AboutPage() {
  return (
    <>
      <div className="py-24 max-w-3xl mx-auto px-4">
        <h1 className="text-5xl font-bold mb-6">About Plug-A-Pro</h1>
        <p className="text-muted-foreground text-xl mb-12">
          Building the operating system for field service businesses in emerging markets.
        </p>
        <div className="prose prose-zinc dark:prose-invert max-w-none">
          <h2>Our mission</h2>
          <p>
            Millions of skilled technicians work in home services across Africa — plumbers, electricians, handymen, HVAC specialists. Most are running their businesses on WhatsApp groups and spreadsheets.
          </p>
          <p>
            Plug-A-Pro gives these businesses the operational infrastructure they deserve: structured bookings, professional dispatch, on-site job tracking, and automatic invoicing — all built around the WhatsApp channel their customers already use.
          </p>
          <h2>Built for the field</h2>
          <p>
            We design everything for real-world field conditions. Low-data PWAs that work on budget Android devices. WhatsApp flows that guide customers without friction. Admin consoles built for speed, not complexity.
          </p>
          <p>
            We support home maintenance businesses and the customers they serve — including customers who started a DIY repair and need a professional to complete it.
          </p>
          <h2>Get in touch</h2>
          <p>
            We&apos;re actively onboarding field service businesses.{" "}
            <a href="/contact">Contact us</a> to learn more or{" "}
            <a href="/waitlist">join the waitlist</a> for early access.
          </p>
        </div>
      </div>
      <CTAStrip />
    </>
  );
}
```

- [ ] **Step 9.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add "app/(marketing)/faq/page.tsx" "app/(marketing)/about/page.tsx"
git commit -m "feat: update FAQ and About pages with real Plug-A-Pro content"
```

---

## Task 10: Write docs (audit, visual direction, content changes, QA checklist)

**Files:**
- Create: `docs/marketing-site/current-site-audit.md`
- Create: `docs/marketing-site/visual-direction.md`
- Create: `docs/marketing-site/content-changes.md`
- Create: `docs/marketing-site/qa-checklist.md`

- [ ] **Step 10.1: Create current-site-audit.md**

```bash
cat > /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/docs/marketing-site/current-site-audit.md << 'EOF'
# Plug-A-Pro Marketing Site — Current Site Audit

Conducted: 2026-03-27

## Site Structure

| Route | Component | Status |
|-------|-----------|--------|
| `/` | Hero, Features, SocialProof, PricingCards, CTAStrip | Mostly generic template — ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel exist but unused |
| `/solutions` | Solutions page | Good Plug-A-Pro content, Cleaning Services present, emoji icons |
| `/how-it-works` | Full flow detail | Strong, specific, no cleaning references — keep as-is |
| `/features` | Features list | Generic placeholders |
| `/pricing` | PricingCards | Generic Free/Pro/Enterprise, no field service context |
| `/about` | About | Generic template placeholders |
| `/faq` | FAQ accordion | Generic template questions |

## Issues Found

### Content
- `lib/metadata.ts` siteConfig: "My Product", placeholder URL, placeholder WhatsApp number
- `components/marketing/Features.tsx`: 6 generic "Feature One/Two" placeholders
- `components/marketing/SocialProof.tsx`: Generic startup testimonials
- `components/marketing/PricingCards.tsx`: Generic tiers with no field service relevance
- `app/(marketing)/about/page.tsx`: "Replace this with..." placeholder text
- `app/(marketing)/faq/page.tsx`: Generic 5 FAQs, not field service relevant
- `app/(marketing)/solutions/page.tsx`: Contains Cleaning Services entry

### Cleaning Services (to remove)
- `app/(marketing)/solutions/page.tsx` — solution card (🧹 Cleaning Services)
- `components/marketing/WhoItsFor.tsx` — industry card (🧹 Cleaning Services)
- `app/(marketing)/solutions/page.tsx` metadata description: mentions "cleaning"

### Generic/Weak Visuals
- All service categories use emoji icons (🔧⚡🧹❄️🏠🔑)
- ProblemStatement uses emoji icons (📋📞🗂️📍)
- No category-specific visual treatment
- `lucide-react` is already installed but unused in these components

### CSS Gaps
- `--accent-pink` used in HowItWorksSteps but not defined in globals.css
- `--accent-green-wa` used in OperatingModel but not defined in globals.css

### Homepage Structure
- Homepage does not use: ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel
- These are the strongest, most specific components in the codebase
- Homepage only shows: Hero (generic) + Features (generic) + SocialProof (generic) + Pricing (generic) + CTA

### Navigation
- Nav links: Features, Pricing, Blog, Docs
- No link to Solutions or How it works — key pages buried

## Recommended Changes
See implementation plan: `docs/superpowers/plans/2026-03-27-pap-marketing-mvp-refinement.md`
EOF
```

- [ ] **Step 10.2: Create visual-direction.md**

```bash
cat > /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/docs/marketing-site/visual-direction.md << 'EOF'
# Plug-A-Pro Marketing Site — Visual Direction

Decided: 2026-03-27

## Icon System: Lucide React

**Decision:** Replace all emoji service icons with Lucide React components.

**Rationale:**
- `lucide-react` is already installed (^1.6.0) — no new dependency
- Lucide icons are consistent in weight, size, and style
- They render cleanly at any DPI, support theming via CSS color, and look professional in dark/light mode
- Emoji rendering is inconsistent across platforms and OS versions

**Service category icon mapping:**
| Category | Lucide Icon | Import |
|----------|-------------|--------|
| Plumbing & Drainage | Wrench | `import { Wrench } from "lucide-react"` |
| Electrical | Zap | `import { Zap } from "lucide-react"` |
| HVAC & Refrigeration | Wind | `import { Wind } from "lucide-react"` |
| General Home Maintenance | Home | `import { Home } from "lucide-react"` |
| Locksmith & Security | Lock | `import { Lock } from "lucide-react"` |
| DIY Project Help | Hammer | `import { Hammer } from "lucide-react"` |

**Feature icon mapping:**
| Feature | Lucide Icon |
|---------|-------------|
| WhatsApp Booking | MessageCircle |
| Smart Dispatch | Navigation |
| Technician PWA | Smartphone |
| Auto-Invoicing | FileText |
| Extra Work Approval | ClipboardCheck |
| Before & After Photos | Camera |

**Problem statement icon mapping:**
| Problem | Lucide Icon |
|---------|-------------|
| Jobs in WhatsApp groups | ClipboardList |
| Phone dispatch | Phone |
| Excel invoicing | FileSpreadsheet |
| No technician status | MapPin |

## Icon Container Style

Service cards use a consistent icon container:
```tsx
<div className="size-10 rounded-xl flex items-center justify-center bg-muted">
  <Icon className="size-5" style={{ color: "var(--accent-brand)" }} aria-hidden="true" />
</div>
```

## Background Treatment

Hero section uses a subtle dot-grid CSS background:
```css
background-image: radial-gradient(circle, var(--border) 1px, transparent 1px);
background-size: 28px 28px;
opacity: 0.04 (light) / 0.07 (dark)
```

## Photos / Illustrations

No external photos or illustrations used in this update. The design relies on:
- Typography and spacing hierarchy
- Lucide icons for visual anchors
- Subtle CSS background treatment in Hero
- Consistent border/muted treatments for cards

This is intentional — avoids stock photo feel, keeps dependencies lean, maintains fast load times.

## What Needs Human Review

- Hero dot-grid background: verify it looks right in both light and dark mode
- Icon choices: verify Lucide icons are available in installed version (^1.6.0)
- Consider adding a real hero image or illustration in a future design sprint
EOF
```

- [ ] **Step 10.3: Create content-changes.md**

```bash
cat > /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/docs/marketing-site/content-changes.md << 'EOF'
# Plug-A-Pro Marketing Site — Content Changes Log

Updated: 2026-03-27

## lib/metadata.ts — siteConfig

| Field | Before | After |
|-------|--------|-------|
| venture | my-product | plug-a-pro |
| name | My Product | Plug-A-Pro |
| description | One-line pitch. | WhatsApp booking, smart dispatch, and automatic invoicing — for any business that sends skilled workers to customer homes. |
| url | https://myproduct.com | https://plugapro.co.za (TODO: production URL) |
| whatsappNumber | +1234567890 | +27000000000 (TODO: real number) |

## Homepage (app/(marketing)/page.tsx)

**Added sections:** ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel
These were already written and available but not shown on the homepage.

**Pricing section sub-heading:** Added supporting sentence below heading.

## Hero (components/marketing/Hero.tsx)

| Element | Before | After |
|---------|--------|-------|
| H1 | {siteConfig.name} ("My Product") | "Book a technician in minutes — via WhatsApp" |
| Subtext | {siteConfig.description} (placeholder) | Real description + DIY line |
| Primary CTA | "Get started free" → app link | "Get early access" → /waitlist |
| Secondary CTA | "See pricing" → /pricing | "See how it works" → /how-it-works |
| Background | Plain | Subtle dot-grid CSS pattern |

## Features (components/marketing/Features.tsx)

Replaced 6 generic "Feature One/Two..." with 6 real features:
WhatsApp Booking, Smart Dispatch, Technician PWA, Auto-Invoicing, Extra Work Approval, Before & After Photos.

## SocialProof (components/marketing/SocialProof.tsx)

Replaced generic startup testimonials with field service business testimonials:
- Plumbing operations manager on dispatch speed
- Home maintenance owner on customer comms
- Electrical admin on invoice dispute elimination

## PricingCards (components/marketing/PricingCards.tsx)

Replaced generic Free/Pro/Enterprise with real field service SaaS tiers:
- Starter: R 999/mo (50 jobs, 3 technicians)
- Growth: R 2 499/mo (unlimited, highlighted)
- Enterprise: Custom

## CTAStrip (components/marketing/CTAStrip.tsx)

| Element | Before | After |
|---------|--------|-------|
| Heading | "Ready to get started?" | "Ready to modernise your field service business?" |
| Subtext | "Join thousands of teams..." | "Plug-A-Pro handles booking, dispatch, and invoicing so you can focus on the work." |
| Primary CTA | "Get started free" → app | "Get early access" → /waitlist |

## Nav (components/shared/Nav.tsx)

| Before | After |
|--------|-------|
| Features | Solutions |
| Pricing | How it works |
| Blog | Pricing |
| Docs | (removed — not a priority nav item) |

## Solutions page (app/(marketing)/solutions/page.tsx)

- **Removed:** Cleaning Services entry
- **Reordered:** Home Maintenance moved to first position
- **Updated:** Home Maintenance headline and points (DIY completion language added)
- **Added:** DIY callout section at bottom of solutions list
- **Updated:** Page metadata description (cleaning reference removed)

## WhoItsFor (components/marketing/WhoItsFor.tsx)

- **Removed:** Cleaning Services (🧹) entry
- **Added:** DIY Project Help (Hammer icon) entry
- **Updated:** Home Maintenance description (added "everyday repairs")
- **Updated:** Footer note (more direct language)

## FAQ (app/(marketing)/faq/page.tsx)

Replaced 5 generic questions with 9 field service specific questions including a DIY completion FAQ entry.

## About (app/(marketing)/about/page.tsx)

Replaced "Replace this with..." placeholders with real Plug-A-Pro mission copy covering Africa field service context, low-data mobile design philosophy, and DIY completion support.

## Items NOT Changed (Kept As-Is)

- `/how-it-works` — already strong, specific content, no cleaning references
- `ProblemStatement` content — already specific and strong (only icons replaced)
- `HowItWorksSteps` — strong content, kept exactly
- `OperatingModel` — strong content, kept exactly
- `WhatsAppButton` — correct and clean
- `WaitlistForm`, `ContactForm` — functional, not content issues
- Pricing page (`/pricing`) — uses PricingCards component (updated via component)
EOF
```

- [ ] **Step 10.4: Create qa-checklist.md**

```bash
cat > /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/docs/marketing-site/qa-checklist.md << 'EOF'
# Plug-A-Pro Marketing Site — QA Checklist

Date: 2026-03-27

## Build & Type Checks

- [ ] `npx tsc --noEmit` passes with no new errors
- [ ] `next lint` passes with no warnings
- [ ] `next build` completes without errors
- [ ] No broken imports or missing module errors

## Cleaning Services Removal

- [ ] `grep -ri "clean" app/ components/` returns no marketing-facing cleaning references
- [ ] `/solutions` page: Cleaning Services entry not visible
- [ ] Homepage (`WhoItsFor`): Cleaning Services card not visible
- [ ] Solutions page metadata: no "cleaning" in description
- [ ] No orphaned routes or 404 links pointing to cleaning content

## Home Maintenance & DIY Positioning

- [ ] `/solutions` page: General Home Maintenance is first entry
- [ ] `/solutions` page: Home Maintenance points include DIY completion language
- [ ] `/solutions` page: DIY callout card visible below solutions grid
- [ ] Homepage (`WhoItsFor`): DIY Project Help card visible (Hammer icon)
- [ ] Hero: DIY mention visible with link to /solutions
- [ ] FAQ: DIY completion question present

## Visual / Icons

- [ ] `WhoItsFor`: 6 Lucide icons visible, no emoji
- [ ] `Features`: 6 Lucide icons visible, no generic placeholders
- [ ] `ProblemStatement`: 4 Lucide icons visible, no emoji
- [ ] Solutions page: Lucide icons per category, no emoji
- [ ] Icon containers consistent: bg-muted + accent-brand color
- [ ] Hero: dot-grid background visible (subtle) in light mode
- [ ] Hero: dot-grid background visible in dark mode
- [ ] All icons have `aria-hidden="true"`

## Content Accuracy

- [ ] siteConfig.name renders as "Plug-A-Pro" throughout
- [ ] Nav logo shows "Plug-A-Pro"
- [ ] Nav links: Solutions, How it works, Pricing
- [ ] Hero H1: "Book a technician in minutes — via WhatsApp"
- [ ] Pricing tiers: Starter R 999/mo, Growth R 2 499/mo, Enterprise Custom
- [ ] Testimonials: field service specific (not generic startup copy)
- [ ] FAQ: 9 real questions (not generic template)
- [ ] About: real mission copy (no "Replace this with..." text)

## Accessibility

- [ ] All icon-only elements have `aria-hidden="true"`
- [ ] Section headings follow H1 → H2 → H3 hierarchy per page
- [ ] Links have descriptive text (no "click here")
- [ ] Buttons have descriptive labels
- [ ] Color contrast meets AA for text on muted backgrounds

## SEO

- [ ] `<title>` on homepage is "Plug-A-Pro"
- [ ] Meta description is set and meaningful (not placeholder)
- [ ] Solutions page metadata does not mention cleaning
- [ ] No noindex on public pages

## Mobile Responsiveness

- [ ] Homepage renders cleanly on 375px wide viewport
- [ ] `WhoItsFor` 2-column grid on mobile, 3-column on md+
- [ ] Hero text doesn't overflow on small screens
- [ ] Nav is usable on mobile (hamburger or inline)
- [ ] Pricing cards stack correctly on mobile

## Items Needing Human Review

- [ ] siteConfig.whatsappNumber: replace "+27000000000" with real number
- [ ] siteConfig.url: replace "https://plugapro.co.za" with production URL
- [ ] siteConfig.links.app: replace with production app URL
- [ ] siteConfig.links.twitter: replace with real social handle
- [ ] Pricing tiers (R 999/R 2 499): confirm with business stakeholder
- [ ] About page: add real team bios and photos when available
- [ ] SocialProof: replace placeholder testimonials with real customer quotes when available
EOF
```

- [ ] **Step 10.5: Commit docs**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add docs/marketing-site/
git commit -m "docs: add marketing site audit, visual direction, content changes, and QA checklist"
```

---

## Task 11: Log to OpenBrain and QA build

- [ ] **Step 11.1: Log audit findings to OpenBrain**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend && pnpm brain -- knowledge add \
  --project "Plug-A-Pro" \
  --domain "engineering" \
  --title "implementation — marketing site MVP refinement (2026-03-27)" \
  --tags "marketing,content,icons,DIY,cleaning-removal" \
  --content "## Summary\nRefactored marketing site to reflect MVP focus: removed Cleaning Services, elevated Home Maintenance, added DIY positioning, replaced emoji icons with Lucide React, replaced all generic template content with real Plug-A-Pro copy.\n\n## What Changed\n- siteConfig updated: name Plug-A-Pro, real description, placeholder URLs noted\n- Missing CSS vars added: --accent-pink, --accent-green-wa\n- Homepage restructured: ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel now visible\n- Hero: real headline + DIY line + updated CTAs\n- Features: 6 real features with Lucide icons\n- Nav: Solutions, How it works, Pricing\n- Pricing: real ZAR tiers (Starter R999, Growth R2499, Enterprise)\n- FAQ: 9 field-service-specific questions\n- About: real mission copy\n\n## Removed\n- Cleaning Services from WhoItsFor, solutions page, and metadata\n\n## Added\n- DIY Project Help card in WhoItsFor (Hammer icon)\n- DIY callout section on /solutions page\n- DIY mention in Hero subtext\n- DIY completion question in FAQ\n\n## Needs Human Review\n- siteConfig.whatsappNumber: needs real number\n- siteConfig.url + links.app: needs production URLs\n- Pricing tiers: confirm ZAR amounts with stakeholders\n- SocialProof: replace with real customer quotes when available\n- About page: add real team bios when available"
```

- [ ] **Step 11.2: Run lint**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npm run lint 2>&1 | tail -20
```

Expected: no errors. Fix any lint issues before proceeding.

- [ ] **Step 11.3: Run typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 11.4: Run build**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npm run build 2>&1 | tail -30
```

Expected: build completes successfully with no errors.

- [ ] **Step 11.5: Final commit and push**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git status
git push
```

- [ ] **Step 11.6: Log final status to OpenBrain**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend && pnpm brain -- knowledge add \
  --project "Plug-A-Pro" \
  --domain "engineering" \
  --title "QA — marketing site MVP refinement build result (2026-03-27)" \
  --tags "marketing,QA,build" \
  --content "## Build Result\nRecord pass/fail status here after running: lint, tsc --noEmit, next build.\n\n## Outstanding Issues\nList any lint or type errors encountered and how they were resolved."
```

---

## Self-Review Against Spec

| Requirement | Task |
|-------------|------|
| Remove Cleaning Services from all marketing surfaces | Task 2 |
| Replace generic visuals with Lucide icons | Task 3 |
| Elevate Home Maintenance | Task 4 |
| DIY positioning added | Tasks 4, 5, 6, 9 |
| Homepage restructured to use strong existing components | Task 7 |
| Hero with real copy | Task 5 |
| Features with real content | Task 6 |
| Nav updated to product-specific links | Task 8 |
| CTAStrip, SocialProof, PricingCards updated | Task 8 |
| FAQ and About pages updated | Task 9 |
| CSS vars fixed (--accent-pink, --accent-green-wa) | Task 1 |
| siteConfig updated | Task 1 |
| Docs: audit, visual-direction, content-changes, qa-checklist | Task 10 |
| OpenBrain logged | Task 11 |
| Git commit + push | Task 11 |
