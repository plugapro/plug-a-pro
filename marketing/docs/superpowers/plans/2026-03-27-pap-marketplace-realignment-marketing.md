# Plug-A-Pro Marketing Site — Marketplace Realignment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite every marketing surface so Plug-A-Pro is clearly positioned as a marketplace connecting customers to independent home-job workers — not a B2B field service SaaS sold to businesses.

**Architecture:** Pure content and component changes within `marketing/`. No new packages, no new routes except `/for-workers`. The existing shadcn/ui + Tailwind v4 + Lucide React conventions are kept throughout. All CTAs use the `Button` component with `nativeButton={false} render={<Link href="..." />}` API. Typecheck (`npx tsc --noEmit`) is the primary verification gate after each task.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, Lucide React ^1.6.0, shadcn/ui, TypeScript, Geist font

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `lib/metadata.ts` | Modify | `description` rewritten to marketplace framing |
| `components/marketing/Hero.tsx` | Modify | New headline, subheadline, dual CTAs (Request help / I want work) |
| `components/marketing/ProblemStatement.tsx` | Modify | Dual framing: customer problems + provider problems side by side |
| `components/marketing/WhoItsFor.tsx` | Modify | Two panels: For Customers (job category grid) + For Workers (worker types) |
| `components/marketing/HowItWorksSteps.tsx` | Modify | 3-step marketplace flow: Describe → Match → Agree + Done |
| `components/marketing/TrustSafety.tsx` | Create | New section: anonymity, screening, quotes, photos, dispute handling |
| `components/marketing/Features.tsx` | Modify | Marketplace features: Smart Matching, Safe Contact, Quote Flow, Job Tracking, Photos, Reviews |
| `components/marketing/OperatingModel.tsx` | Modify | Dual-side: how customers use it + how workers use it |
| `components/marketing/SocialProof.tsx` | Modify | Consumer + provider testimonials (remove all B2B business operator voices) |
| `components/marketing/CTAStrip.tsx` | Modify | Dual-audience close |
| `components/shared/Nav.tsx` | Modify | Add "For Workers" + "Trust & Safety" links, dual CTAs |
| `app/(marketing)/page.tsx` | Modify | Add `TrustSafety`, remove pricing section inline |
| `app/(marketing)/how-it-works/page.tsx` | Modify | Marketplace flow: Request → Match → Lead accept → Quote → Job → Done |
| `app/(marketing)/solutions/page.tsx` | Modify | Rebrand as "Services" — job categories from customer perspective |
| `app/(marketing)/for-workers/page.tsx` | Create | New page: provider benefits, onboarding steps, registration CTA |
| `app/(marketing)/faq/page.tsx` | Modify | Dual-audience FAQ (customer + worker questions) |
| `app/(marketing)/pricing/page.tsx` | Modify | Remove SaaS tiers, replace with "Join free" waitlist framing |

---

## Task 1: Update siteConfig description

**Files:**
- Modify: `lib/metadata.ts`

- [ ] **Step 1.1: Update the description string**

In `marketing/lib/metadata.ts`, change the `description` field:

```ts
export const siteConfig = {
  venture: "plug-a-pro",
  name: "Plug-A-Pro",
  description:
    "Find nearby handymen and home-job workers via WhatsApp. Get quotes, book help, and get the job done — safely and simply.",
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

- [ ] **Step 1.2: Verify typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 1.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add lib/metadata.ts
git commit -m "content: update siteConfig description to marketplace framing"
```

---

## Task 2: Rewrite Hero

**Files:**
- Modify: `components/marketing/Hero.tsx`

- [ ] **Step 2.1: Replace the entire file**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

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
          Local help. Real quotes. Any small job.
        </p>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
          Get home help in minutes — not weeks
        </h1>
        <p className="text-xl text-muted-foreground mb-3 max-w-2xl mx-auto">
          Plug-A-Pro connects you to nearby handymen and home-job workers for
          small repairs, odd jobs, garden work, painting, and more. Message on
          WhatsApp. Get matched. Get it done.
        </p>
        <p className="text-sm text-muted-foreground mb-10 max-w-lg mx-auto">
          Started a DIY project and got stuck?{" "}
          <Link
            href="/how-it-works"
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            Our workers can assess, continue, or finish it.
          </Link>
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button
            nativeButton={false}
            render={<Link href="/waitlist" />}
            size="lg"
          >
            Request help
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/for-workers" />}
            variant="outline"
            size="lg"
          >
            I want work →
          </Button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/Hero.tsx
git commit -m "content: rewrite Hero for marketplace — dual-audience CTAs"
```

---

## Task 3: Rewrite ProblemStatement

**Files:**
- Modify: `components/marketing/ProblemStatement.tsx`

- [ ] **Step 3.1: Replace the entire file**

```tsx
import {
  SearchX,
  ShieldOff,
  Hourglass,
  FileWarning,
  TrendingDown,
  Lock,
} from "lucide-react";

const CUSTOMER_PROBLEMS: { icon: React.ElementType; label: string; problem: string }[] = [
  {
    icon: SearchX,
    label: "No trusted way to find local help",
    problem: "Searching online gives big national companies, not nearby workers",
  },
  {
    icon: ShieldOff,
    label: "No protection when paying strangers",
    problem: "Cash upfront with no record — no recourse if something goes wrong",
  },
  {
    icon: FileWarning,
    label: "No quote before work starts",
    problem: "Price surprises after the job is done, with nothing in writing",
  },
  {
    icon: Lock,
    label: "Your number shared with strangers",
    problem: "No safe way to communicate without exposing personal contact details",
  },
];

const PROVIDER_PROBLEMS: { icon: React.ElementType; label: string; problem: string }[] = [
  {
    icon: TrendingDown,
    label: "Skilled and available, but no steady work",
    problem: "Sitting outside the hardware store hoping someone walks past",
  },
  {
    icon: Hourglass,
    label: "Word-of-mouth is slow and unreliable",
    problem: "Work comes in bursts — famine and feast with no way to control it",
  },
  {
    icon: FileWarning,
    label: "No structured way to quote or confirm",
    problem: "Verbal agreements that lead to payment disputes later",
  },
  {
    icon: ShieldOff,
    label: "Hard to build trust with new customers",
    problem: "No reputation, no reviews — every new job is a cold start",
  },
];

function ProblemColumn({
  label,
  headline,
  body,
  items,
}: {
  label: string;
  headline: string;
  body: string;
  items: { icon: React.ElementType; label: string; problem: string }[];
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
        {label}
      </p>
      <h2 className="text-2xl md:text-3xl font-bold mb-3 leading-tight">
        {headline}
      </h2>
      <p className="text-muted-foreground leading-relaxed mb-6 text-sm">{body}</p>
      <div className="space-y-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="flex items-start gap-4 rounded-xl border border-border/40 p-4"
            >
              <div className="size-9 rounded-lg flex items-center justify-center bg-muted flex-shrink-0">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-sm">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.problem}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import React from "react";

export function ProblemStatement() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            The problem
          </p>
          <h2 className="text-3xl md:text-4xl font-bold">
            Two sides. Same frustration.
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-10">
          <ProblemColumn
            label="For customers"
            headline="Getting home help shouldn't be this hard"
            body="Finding a trustworthy worker for a small job is harder than it should be — and too risky when you don't know who's coming to your home."
            items={CUSTOMER_PROBLEMS}
          />
          <ProblemColumn
            label="For workers"
            headline="Skills aren't the problem. Access to work is."
            body="Skilled independent workers across South Africa have the ability — they just lack a safe, structured way to connect with paying customers."
            items={PROVIDER_PROBLEMS}
          />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/ProblemStatement.tsx
git commit -m "content: rewrite ProblemStatement with dual customer/provider framing"
```

---

## Task 4: Rewrite WhoItsFor

**Files:**
- Modify: `components/marketing/WhoItsFor.tsx`

- [ ] **Step 4.1: Replace the entire file**

```tsx
import type { LucideIcon } from "lucide-react";
import {
  Wrench,
  Zap,
  Flower2,
  Home,
  Hammer,
  WashingMachine,
  Paintbrush,
  ShieldCheck,
} from "lucide-react";

const JOB_CATEGORIES: { icon: LucideIcon; name: string; description: string }[] = [
  { icon: Wrench, name: "Plumbing", description: "Taps, toilets, drains, leaks, and pipe repairs" },
  { icon: Paintbrush, name: "Painting", description: "Interior and exterior, rooms or touch-ups" },
  { icon: Flower2, name: "Garden & Lawn", description: "Mowing, clearing, trimming, and landscaping" },
  { icon: Home, name: "Handyman / Odd Jobs", description: "Shelves, fixtures, doors, tiling, and everyday repairs" },
  { icon: WashingMachine, name: "Appliances", description: "Fault-finding, inspection, and repair" },
  { icon: Zap, name: "Electrical (minor)", description: "Light fittings, plugs, and small installations" },
  { icon: Hammer, name: "DIY Assistance", description: "Stuck on a project? Get help to finish it properly" },
  { icon: ShieldCheck, name: "General Repairs", description: "Drywall, plastering, grouting, and home upkeep" },
];

const WORKER_TYPES: string[] = [
  "Gardeners and landscapers",
  "Painters",
  "Handymen and odd-job workers",
  "Plumbers (small jobs)",
  "Appliance repairers",
  "Electricians (minor work)",
  "General DIY workers and installers",
  "Roofing helpers",
];

export function WhoItsFor() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto space-y-16">

        {/* For Customers */}
        <div>
          <div className="mb-10">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              For customers
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Any small home job — sorted
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Whether you need a tap fixed, a room painted, or help finishing a DIY project, Plug-A-Pro matches you with a nearby worker who can do the job.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {JOB_CATEGORIES.map((category) => {
              const Icon = category.icon;
              return (
                <div
                  key={category.name}
                  className="rounded-2xl border border-border/40 p-5 space-y-3 hover:shadow-sm transition-shadow"
                >
                  <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="font-semibold text-sm">{category.name}</h3>
                  <p className="text-xs text-muted-foreground">{category.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/40" />

        {/* For Workers */}
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              For workers
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Get steady local work — on your terms
            </h2>
            <p className="text-muted-foreground mb-6">
              If you have practical skills and need access to paying customers, Plug-A-Pro brings the jobs to you. No formal business structure needed — just your skills and a smartphone.
            </p>
            <ul className="space-y-2">
              {WORKER_TYPES.map((type) => (
                <li key={type} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span
                    className="size-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                  {type}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border/40 p-8 space-y-4 bg-muted/30">
            <p className="font-semibold text-lg">What you get as a worker</p>
            {[
              "Leads matched to your skills and area",
              "Structured quote and booking flow — no verbal confusion",
              "Job photos and audit trail protect you too",
              "Customer reviews build your reputation over time",
              "No cold-calling, no cash awkwardness — payment is structured",
              "Works from any smartphone with WhatsApp",
            ].map((benefit) => (
              <div key={benefit} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span
                  className="mt-1 size-1.5 rounded-full flex-shrink-0"
                  style={{ background: "var(--accent-green-wa)" }}
                  aria-hidden="true"
                />
                {benefit}
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
```

- [ ] **Step 4.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/WhoItsFor.tsx
git commit -m "content: rewrite WhoItsFor with dual customer/worker audience sections"
```

---

## Task 5: Rewrite HowItWorksSteps

**Files:**
- Modify: `components/marketing/HowItWorksSteps.tsx`

- [ ] **Step 5.1: Replace the entire file**

```tsx
import Link from "next/link";

const STEPS = [
  {
    number: "01",
    title: "Describe your job",
    description:
      "Send a message on WhatsApp or use the app. Tell us what needs doing, where you are, and share a photo if helpful. Takes under 3 minutes.",
    detail: "Works on any phone with WhatsApp. No app download needed.",
  },
  {
    number: "02",
    title: "Get matched to a nearby worker",
    description:
      "We find available, rated workers near you who do that type of job. A lead is sent to matching workers — the first to accept, or the one you choose, takes the job.",
    detail: "Your personal number is not shared at this stage.",
  },
  {
    number: "03",
    title: "Agree on price, book, done",
    description:
      "The worker visits to inspect if needed, or sends a quote directly. You approve before any work starts. Pay after it's done — safely and with a record.",
    detail: "Extra work requires your explicit approval before it begins.",
  },
];

export function HowItWorksSteps() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            How it works
          </p>
          <h2 className="text-3xl md:text-4xl font-bold">
            From job to done — in a few taps
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {STEPS.map((step) => (
            <div key={step.number} className="relative">
              <div
                className="text-5xl font-bold mb-4 bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
                }}
                aria-hidden="true"
              >
                {step.number}
              </div>
              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                {step.description}
              </p>
              <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                {step.detail}
              </p>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <Link
            href="/how-it-works"
            className="text-sm font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            See the full flow in detail →
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/HowItWorksSteps.tsx
git commit -m "content: rewrite HowItWorksSteps — marketplace flow Describe→Match→Done"
```

---

## Task 6: Create TrustSafety component

**Files:**
- Create: `components/marketing/TrustSafety.tsx`

- [ ] **Step 6.1: Create the file**

```tsx
import {
  Phone,
  UserCheck,
  FileText,
  Camera,
  MessageCircle,
  Star,
} from "lucide-react";

const TRUST_POINTS: {
  icon: React.ElementType;
  title: string;
  body: string;
}[] = [
  {
    icon: Phone,
    title: "Your number stays private",
    body: "By default, your personal WhatsApp number is not shared with the other party. All messages go through the Plug-A-Pro platform.",
  },
  {
    icon: UserCheck,
    title: "Workers are screened before activation",
    body: "Every provider goes through a review process before they can receive leads. Suspended workers cannot return without re-review.",
  },
  {
    icon: FileText,
    title: "All quotes are documented",
    body: "Quotes are submitted through the platform, not verbally. You see the price before agreeing — and so does your worker.",
  },
  {
    icon: Camera,
    title: "Before and after photos on every job",
    body: "Workers upload photos at the start and end of every job. Immutable proof — for your protection and theirs.",
  },
  {
    icon: MessageCircle,
    title: "Disputes handled on the platform",
    body: "If something goes wrong, raise it through the platform. We have the full job record — status history, photos, quotes, and messages.",
  },
  {
    icon: Star,
    title: "Ratings build over time",
    body: "Every completed job adds a review to the worker's profile. You can see their track record before accepting a quote.",
  },
];

import React from "react";

export function TrustSafety() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Trust & safety
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built for two strangers to work together safely
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Every feature is designed so neither side has to take an uncomfortable leap of faith.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TRUST_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <div
                key={point.title}
                className="rounded-2xl border border-border/40 p-6 space-y-3"
              >
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon
                    className="size-5"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="font-semibold text-sm">{point.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {point.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/TrustSafety.tsx
git commit -m "feat: add TrustSafety component — anonymity, screening, photos, disputes"
```

---

## Task 7: Rewrite Features

**Files:**
- Modify: `components/marketing/Features.tsx`

- [ ] **Step 7.1: Replace the entire file**

```tsx
import type { LucideIcon } from "lucide-react";
import {
  MapPin,
  Phone,
  FileText,
  Navigation,
  Camera,
  Star,
} from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: MapPin,
    title: "Local matching",
    description:
      "Jobs are matched to workers by proximity and skill. Customers get someone nearby. Workers get jobs they can actually reach.",
  },
  {
    icon: Phone,
    title: "Safe contact",
    description:
      "Neither party's personal number is shared by default. All communication is mediated through the platform until both sides are comfortable.",
  },
  {
    icon: FileText,
    title: "Structured quotes",
    description:
      "Quotes are submitted in writing with a description and price. Customers approve before any work begins. No verbal agreements.",
  },
  {
    icon: Navigation,
    title: "Live job tracking",
    description:
      "Customers get WhatsApp updates at every stage — worker on the way, arrived, job started, completed. No more chasing for updates.",
  },
  {
    icon: Camera,
    title: "Before & after photos",
    description:
      "Workers upload photos at the start and end of every job. Immutable proof for both sides — protects against disputes.",
  },
  {
    icon: Star,
    title: "Trusted reviews",
    description:
      "Every completed job builds the worker's public profile. Customers can see reviews before they accept a quote.",
  },
];

export function Features() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">
          Everything that makes the match work
        </h2>
        <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
          From the moment a job is described to the moment it's done — the platform handles matching, communication, quoting, tracking, and trust.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="space-y-3">
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon
                    className="size-5"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
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

- [ ] **Step 7.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/Features.tsx
git commit -m "content: rewrite Features — marketplace features replacing B2B dispatch features"
```

---

## Task 8: Rewrite OperatingModel

**Files:**
- Modify: `components/marketing/OperatingModel.tsx`

- [ ] **Step 8.1: Replace the entire file**

```tsx
export function OperatingModel() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            How the platform works
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            WhatsApp is the front door. The app is the engine.
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Customers and workers both operate through the channels they already use — no friction, no app store.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Customers */}
          <div className="rounded-2xl border border-border/40 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">🏠</span>
              <div>
                <h3 className="font-bold text-lg">For customers</h3>
                <p className="text-xs text-muted-foreground">Request, approve, and track</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                "Describe your job on WhatsApp in under 3 minutes",
                "Receive a notification when a worker is matched",
                "View the worker's profile and rating before accepting",
                "Get the quote in writing — approve before work starts",
                "Track live status: on the way, arrived, in progress",
                "Pay after the job. Leave a review. Done.",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span
                    className="mt-1 size-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Workers */}
          <div className="rounded-2xl border border-border/40 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">🔧</span>
              <div>
                <h3 className="font-bold text-lg">For workers</h3>
                <p className="text-xs text-muted-foreground">Accept leads, quote, earn</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                "Register via WhatsApp — no paperwork or app store needed",
                "Set your skills, areas, and availability once",
                "Receive matched leads on WhatsApp — accept or decline",
                "Submit structured quotes with photos directly from the app",
                "Update job status from your phone as you work",
                "Build your rating with every completed job",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span
                    className="mt-1 size-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--accent-green-wa)" }}
                    aria-hidden="true"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-8">
          Both sides can also use the app for a richer view — quotes, photos, job history, and profile management.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 8.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/OperatingModel.tsx
git commit -m "content: rewrite OperatingModel — dual-side customer/worker view"
```

---

## Task 9: Rewrite SocialProof

**Files:**
- Modify: `components/marketing/SocialProof.tsx`

- [ ] **Step 9.1: Replace the entire file**

```tsx
const TESTIMONIALS = [
  {
    quote:
      "I had a leaking tap and a dripping shower head. Described both on WhatsApp, got a plumber the next morning. Price was exactly what was quoted — not a cent more.",
    author: "Thandi M.",
    role: "Homeowner, Bryanston",
  },
  {
    quote:
      "I get 3 to 4 jobs a week through the app now. Before this I was just standing outside Builders Warehouse hoping someone would walk past. It's changed everything.",
    author: "Sipho D.",
    role: "Handyman, Johannesburg South",
  },
  {
    quote:
      "I started building a deck but got completely stuck on the concrete footing. Found someone through Plug-A-Pro who sorted it in two hours. He finished the whole thing the next weekend.",
    author: "Ryan K.",
    role: "DIYer, Centurion",
  },
];

export function SocialProof() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">
          From people who've used it
        </h2>
        <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
          Customers who got their jobs done. Workers who got steady work.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t) => (
            <div
              key={t.author}
              className="rounded-xl border border-border p-6 space-y-4 flex flex-col"
            >
              <p className="text-muted-foreground italic flex-1">
                &ldquo;{t.quote}&rdquo;
              </p>
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

- [ ] **Step 9.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 9.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/SocialProof.tsx
git commit -m "content: rewrite SocialProof — consumer + worker testimonials"
```

---

## Task 10: Rewrite CTAStrip

**Files:**
- Modify: `components/marketing/CTAStrip.tsx`

- [ ] **Step 10.1: Replace the entire file**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTAStrip() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <h2 className="text-3xl font-bold">
          Need home help? Or want steady work?
        </h2>
        <p className="text-muted-foreground">
          Plug-A-Pro is built for both sides. Customers get trustworthy local help. Workers get structured access to paying jobs.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button
            nativeButton={false}
            render={<Link href="/waitlist" />}
            size="lg"
          >
            Request help
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/for-workers" />}
            variant="outline"
            size="lg"
          >
            Register as a worker
          </Button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 10.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 10.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/marketing/CTAStrip.tsx
git commit -m "content: rewrite CTAStrip — dual-audience close"
```

---

## Task 11: Update Nav

**Files:**
- Modify: `components/shared/Nav.tsx`

- [ ] **Step 11.1: Replace the entire file**

```tsx
import Link from "next/link";
import { siteConfig } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const navLinks = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/for-workers", label: "For workers" },
  { href: "/faq", label: "FAQ" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="font-bold text-sm">
          {siteConfig.name}
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            nativeButton={false}
            render={<Link href="/waitlist" />}
            size="sm"
          >
            Request help
          </Button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 11.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 11.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add components/shared/Nav.tsx
git commit -m "content: update Nav — marketplace links, request help CTA"
```

---

## Task 12: Update homepage (page.tsx)

**Files:**
- Modify: `app/(marketing)/page.tsx`

- [ ] **Step 12.1: Replace the entire file**

Remove the inline pricing section. Add `TrustSafety` between `Features` and `SocialProof`.

```tsx
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Hero } from "@/components/marketing/Hero";
import { ProblemStatement } from "@/components/marketing/ProblemStatement";
import { WhoItsFor } from "@/components/marketing/WhoItsFor";
import { HowItWorksSteps } from "@/components/marketing/HowItWorksSteps";
import { OperatingModel } from "@/components/marketing/OperatingModel";
import { Features } from "@/components/marketing/Features";
import { TrustSafety } from "@/components/marketing/TrustSafety";
import { SocialProof } from "@/components/marketing/SocialProof";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({});

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorksSteps />
      <ProblemStatement />
      <WhoItsFor />
      <TrustSafety />
      <OperatingModel />
      <Features />
      <SocialProof />
      <CTAStrip />
    </>
  );
}
```

- [ ] **Step 12.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 12.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add app/\(marketing\)/page.tsx
git commit -m "content: update homepage — add TrustSafety, remove SaaS pricing section"
```

---

## Task 13: Rewrite How It Works page

**Files:**
- Modify: `app/(marketing)/how-it-works/page.tsx`

- [ ] **Step 13.1: Replace the entire file**

```tsx
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "How It Works",
  description:
    "See how Plug-A-Pro connects customers to nearby home-job workers — from describing the job to getting it done safely.",
});

const CUSTOMER_STEPS = [
  {
    step: "1",
    title: "Describe your job",
    detail:
      "Send a message to the Plug-A-Pro WhatsApp number or use the web form. Tell us what needs doing, where you are, and your preferred timing. Attach a photo if it helps — especially useful for repairs and DIY rescues.",
  },
  {
    step: "2",
    title: "Get matched to a nearby worker",
    detail:
      "The platform finds available workers near you who have the right skills. A lead is sent to up to four matching workers simultaneously. You're notified when one accepts.",
  },
  {
    step: "3",
    title: "Inspect (if needed) and get a quote",
    detail:
      "For jobs that are hard to price remotely, the worker can visit to inspect first — no cost until you accept a quote. For simpler jobs, a quote is sent directly. You see the price and description before committing.",
  },
  {
    step: "4",
    title: "Approve the quote",
    detail:
      "You approve in writing through the platform before any work starts. If the scope changes on-site, the worker must request your approval before proceeding with extra work.",
  },
  {
    step: "5",
    title: "Track the job live",
    detail:
      "You receive WhatsApp updates at every milestone: worker on the way, arrived, job started, completed. No more chasing for ETAs.",
  },
  {
    step: "6",
    title: "Pay and leave a review",
    detail:
      "Pay after the job is done. Leave a rating and comment to help build the worker's reputation — and help the next customer make a confident choice.",
  },
];

const WORKER_STEPS = [
  {
    step: "1",
    title: "Register via WhatsApp or the web",
    detail:
      "Tell us your name, what jobs you do, which areas you cover, and your typical availability. No formal business registration required — just your skills and a smartphone.",
  },
  {
    step: "2",
    title: "Platform review and activation",
    detail:
      "Your application is reviewed before you receive leads. Once activated, your profile is live and you're eligible for matched jobs in your area.",
  },
  {
    step: "3",
    title: "Receive matched leads",
    detail:
      "When a customer job matches your skills and area, you receive a lead notification on WhatsApp. The lead shows the job category, suburb, and urgency — not the customer's personal number yet.",
  },
  {
    step: "4",
    title: "Accept or decline",
    detail:
      "Tap to accept if you can do the job. Once accepted, you get the full address and can open the platform message thread to communicate with the customer.",
  },
  {
    step: "5",
    title: "Inspect, quote, and execute",
    detail:
      "Visit to inspect if needed, or send a written quote directly from the app with a description and price. Once accepted, update your job status as you work — en route, arrived, started, completed.",
  },
  {
    step: "6",
    title: "Get paid and build your rating",
    detail:
      "Payment is structured through the platform. After each job you receive a rating — reviews accumulate on your profile and help you win more work over time.",
  },
];

function FlowSection({
  label,
  title,
  steps,
}: {
  label: string;
  title: string;
  steps: { step: string; title: string; detail: string }[];
}) {
  return (
    <div className="mb-16">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
        {label}
      </p>
      <h2 className="text-2xl md:text-3xl font-bold mb-8">{title}</h2>
      <div className="space-y-0">
        {steps.map((s, i) => (
          <div key={s.step} className="flex gap-5">
            <div className="flex flex-col items-center">
              <div
                className="size-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
                }}
              >
                {s.step}
              </div>
              {i < steps.length - 1 && (
                <div className="w-px flex-1 bg-border/60 my-1" />
              )}
            </div>
            <div className="pb-8">
              <h3 className="font-semibold mb-1">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {s.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <>
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          The full picture
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          How Plug-A-Pro works
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          Two flows. One platform. From a WhatsApp message to a completed job — safely and simply.
        </p>
      </div>

      <div className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <FlowSection
            label="Customer flow"
            title="Request help — from job description to done"
            steps={CUSTOMER_STEPS}
          />
          <FlowSection
            label="Worker flow"
            title="Register, receive leads, build your reputation"
            steps={WORKER_STEPS}
          />

          <div className="rounded-2xl border border-border/40 p-6 bg-muted/30 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-2">
              Your number stays private
            </p>
            <p>
              Neither party's personal WhatsApp number is shared by default. All communication goes through the Plug-A-Pro platform — the customer's address is only revealed to the worker in stages, as the job progresses through acceptance and confirmation.
            </p>
          </div>
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
```

- [ ] **Step 13.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 13.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add app/\(marketing\)/how-it-works/page.tsx
git commit -m "content: rewrite how-it-works — marketplace customer and worker flows"
```

---

## Task 14: Create For Workers page

**Files:**
- Create: `app/(marketing)/for-workers/page.tsx`

- [ ] **Step 14.1: Create the file**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { Smartphone, MapPin, Star, ShieldCheck } from "lucide-react";

export const metadata: Metadata = buildMetadata({
  title: "For Workers",
  description:
    "Register as a home-job worker on Plug-A-Pro. Get matched to local customers, receive structured leads, submit quotes, and build your reputation.",
});

const BENEFITS = [
  {
    icon: MapPin,
    title: "Jobs matched to your area",
    body: "Set your coverage suburbs once. Only receive leads for jobs you can actually reach.",
  },
  {
    icon: Smartphone,
    title: "Everything runs on WhatsApp",
    body: "Receive leads, accept jobs, and get notified — all through the WhatsApp you already use. No app store required.",
  },
  {
    icon: ShieldCheck,
    title: "Structured quotes protect you",
    body: "Quotes and extra work requests are documented in writing. No more verbal disputes over what was agreed.",
  },
  {
    icon: Star,
    title: "Reviews build your business",
    body: "Every completed job adds a rating to your public profile. Customers see your track record before they choose you.",
  },
];

const HOW_TO_JOIN = [
  {
    step: "1",
    title: "Register",
    detail:
      "Message the Plug-A-Pro WhatsApp number or fill in the form below. Tell us your name, the types of jobs you do, which suburbs you cover, and your availability.",
  },
  {
    step: "2",
    title: "Get reviewed",
    detail:
      "Your application goes through a quick review. Once approved, your profile is active and you're ready to receive matched leads.",
  },
  {
    step: "3",
    title: "Start receiving work",
    detail:
      "When a job matches your skills and area, you'll get a WhatsApp notification. Accept the lead, communicate through the platform, submit your quote, do the job, get paid.",
  },
];

export default function ForWorkersPage() {
  return (
    <>
      {/* Header */}
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          For workers
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Your skills. Steady local work.
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg mb-8">
          Plug-A-Pro brings paying home-job customers to you. Register once, set your areas and skills, and start receiving matched leads on WhatsApp.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="lg">
            Register as a worker
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/how-it-works" />}
            variant="outline"
            size="lg"
          >
            See how it works
          </Button>
        </div>
      </div>

      {/* Benefits */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            What you get when you join
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {BENEFITS.map((b) => {
              const Icon = b.icon;
              return (
                <div
                  key={b.title}
                  className="rounded-2xl border border-border/40 p-6 flex gap-5"
                >
                  <div className="size-10 rounded-xl flex items-center justify-center bg-muted flex-shrink-0">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{b.title}</h3>
                    <p className="text-sm text-muted-foreground">{b.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How to join */}
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            How to join
          </h2>
          <div className="space-y-0">
            {HOW_TO_JOIN.map((s, i) => (
              <div key={s.step} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div
                    className="size-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
                    }}
                  >
                    {s.step}
                  </div>
                  {i < HOW_TO_JOIN.length - 1 && (
                    <div className="w-px flex-1 bg-border/60 my-1" />
                  )}
                </div>
                <div className="pb-8">
                  <h3 className="font-semibold mb-1">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {s.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who we're looking for */}
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-3xl mx-auto rounded-2xl border border-border/40 p-8 bg-muted/30">
          <h2 className="text-xl font-bold mb-4">Who we're looking for</h2>
          <p className="text-sm text-muted-foreground mb-4">
            You don't need a formal business or company registration to join. If you have practical skills and a track record of doing good work, we want to hear from you.
          </p>
          <ul className="grid grid-cols-2 gap-2 mb-6">
            {[
              "Gardeners and landscapers",
              "Painters",
              "Handymen and odd-job workers",
              "Plumbers (small jobs)",
              "Appliance repairers",
              "Electricians (minor work)",
              "General DIY workers",
              "Installers",
            ].map((type) => (
              <li
                key={type}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <span
                  className="size-1.5 rounded-full flex-shrink-0"
                  style={{ background: "var(--accent-green-wa)" }}
                  aria-hidden="true"
                />
                {type}
              </li>
            ))}
          </ul>
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="sm">
            Register now
          </Button>
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
```

- [ ] **Step 14.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 14.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add app/\(marketing\)/for-workers/page.tsx
git commit -m "feat: add /for-workers page — provider benefits, onboarding steps, registration CTA"
```

---

## Task 15: Rewrite Solutions page to Services

**Files:**
- Modify: `app/(marketing)/solutions/page.tsx`

- [ ] **Step 15.1: Replace the entire file**

```tsx
import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import {
  Wrench,
  Zap,
  Flower2,
  Home,
  Hammer,
  WashingMachine,
  Paintbrush,
  ShieldCheck,
} from "lucide-react";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "Services",
  description:
    "Plug-A-Pro matches you to nearby workers for plumbing, painting, garden work, handyman jobs, appliance repairs, electrical, and DIY assistance.",
});

const SERVICES: {
  icon: LucideIcon;
  name: string;
  headline: string;
  examples: string[];
}[] = [
  {
    icon: Home,
    name: "Handyman & General Repairs",
    headline: "Everyday home maintenance done properly",
    examples: [
      "Shelf fitting, door adjustments, hinge replacements",
      "Grouting, tiling repairs, and minor plastering",
      "Furniture assembly and mounting",
      "Drywall patching and finishing",
      "General household upkeep and odd jobs",
    ],
  },
  {
    icon: Paintbrush,
    name: "Painting",
    headline: "Interior and exterior painting — rooms or touch-ups",
    examples: [
      "Full room repaints",
      "Feature wall or accent painting",
      "Touch-up and repair painting",
      "Exterior wall and fence painting",
      "Prep work, filling, and sanding included",
    ],
  },
  {
    icon: Flower2,
    name: "Garden & Lawn",
    headline: "Outdoor spaces cleared, cut, and cared for",
    examples: [
      "Lawn mowing and edging",
      "Clearing overgrown garden areas",
      "Tree trimming and hedge cutting",
      "Weeding and general garden upkeep",
      "Planting and basic landscaping",
    ],
  },
  {
    icon: Wrench,
    name: "Plumbing (small jobs)",
    headline: "Leaks, drips, blockages, and fittings",
    examples: [
      "Tap and mixer repairs or replacements",
      "Toilet cistern and flush mechanism repairs",
      "Blocked drain clearing",
      "Shower head and fitting replacements",
      "Geyser blanket and overflow pipe checks",
    ],
  },
  {
    icon: WashingMachine,
    name: "Appliances",
    headline: "Fault-finding and repair for household appliances",
    examples: [
      "Washing machine not draining or spinning",
      "Dishwasher door, pump, or seal issues",
      "Fridge and freezer fault assessment",
      "Oven and stove element replacements",
      "Tumble dryer belt and motor faults",
    ],
  },
  {
    icon: Zap,
    name: "Electrical (minor)",
    headline: "Light fittings, plugs, and small installations",
    examples: [
      "Light fitting installation or replacement",
      "Plug and socket faults",
      "DB board trip investigation",
      "Outdoor light and sensor fitting",
      "Extending a power point or adding a switch",
    ],
  },
  {
    icon: Hammer,
    name: "DIY Assistance",
    headline: "Started a job yourself? Get it finished properly",
    examples: [
      "Project assessment and honest advice",
      "Continuing a half-finished repair",
      "Correcting DIY work that didn't go to plan",
      "Providing the tools or materials knowledge you're missing",
      "Any home repair that got out of hand",
    ],
  },
  {
    icon: ShieldCheck,
    name: "Roofing (minor)",
    headline: "Leaks, loose tiles, and gutter repairs",
    examples: [
      "Locating and sealing roof leaks",
      "Broken or slipped tile replacement",
      "Gutter clearing and reattachment",
      "Fascia board repairs",
      "Flashing and valley repairs",
    ],
  },
];

export default function ServicesPage() {
  return (
    <>
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Services
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Small jobs done right
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          Plug-A-Pro matches you to nearby workers for a wide range of small home jobs. Describe what you need — we'll find the right person.
        </p>
      </div>

      <div className="py-16 px-4">
        <div className="max-w-5xl mx-auto space-y-8">
          {SERVICES.map((service) => {
            const Icon = service.icon;
            return (
              <div
                key={service.name}
                className="rounded-2xl border border-border/40 p-8 grid md:grid-cols-3 gap-8"
              >
                <div>
                  <Icon
                    className="size-10 mb-3"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                  <h2 className="font-bold text-xl mb-1">{service.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {service.headline}
                  </p>
                </div>
                <ul className="md:col-span-2 space-y-3">
                  {service.examples.map((example) => (
                    <li
                      key={example}
                      className="flex items-start gap-3 text-sm text-muted-foreground"
                    >
                      <span
                        className="mt-1.5 size-1.5 rounded-full flex-shrink-0"
                        style={{ background: "var(--accent-brand)" }}
                        aria-hidden="true"
                      />
                      {example}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="py-8 px-4">
        <div className="max-w-2xl mx-auto rounded-2xl border border-border/40 p-8 bg-muted/30 text-center">
          <p className="font-semibold text-foreground mb-2">
            Don&apos;t see what you need?
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            If it&apos;s a small home job, there&apos;s probably a worker near you who can do it. Describe your job and we&apos;ll try to match you.
          </p>
          <a
            href="/waitlist"
            className="text-sm font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            Request help →
          </a>
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
```

- [ ] **Step 15.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 15.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add app/\(marketing\)/solutions/page.tsx
git commit -m "content: rewrite Solutions as Services — job categories from customer perspective"
```

---

## Task 16: Rewrite FAQ

**Files:**
- Modify: `app/(marketing)/faq/page.tsx`

- [ ] **Step 16.1: Replace the entire file**

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
  description:
    "Frequently asked questions about Plug-A-Pro — for customers looking for home-job help and workers looking for local jobs.",
});

const CUSTOMER_FAQS = [
  {
    q: "What is Plug-A-Pro?",
    a: "Plug-A-Pro is a marketplace that connects people in South Africa to nearby independent handymen and home-job workers. You describe your job, we match you to a rated local worker, and the whole process — quoting, booking, tracking, and payment — happens through the platform.",
  },
  {
    q: "What types of jobs can I get help with?",
    a: "Plumbing, painting, garden and lawn care, handyman and odd jobs, appliance repairs, minor electrical, DIY assistance, roofing (minor), and general home repairs. If it's a small home job, describe it — we'll try to match you.",
  },
  {
    q: "Do I need to download an app?",
    a: "No. You can describe your job and get updates entirely through WhatsApp — no app, no account needed to start. There's also a web app available for a richer view of quotes and history.",
  },
  {
    q: "Will the worker see my phone number?",
    a: "Not by default. All communication at the matching and quoting stage goes through the Plug-A-Pro platform. Your personal number is only shared if you and the worker explicitly agree to direct contact.",
  },
  {
    q: "How do quotes work?",
    a: "After accepting a lead, the worker sends a written quote through the platform — description, price, and timeline. You approve before any work starts. If extra work is needed on-site, the worker must send an additional request before proceeding.",
  },
  {
    q: "What happens if something goes wrong?",
    a: "Raise a dispute through the platform. We have the full job record — status history, photos, quotes, and messages. Disputes are reviewed and resolved by the Plug-A-Pro team.",
  },
  {
    q: "Started a DIY project and got stuck?",
    a: "Yes — our workers can assess, continue, or finish a job you started yourself. Describe where you are and what you need, and we'll match you to someone who can help.",
  },
  {
    q: "How do I pay?",
    a: "Payment is arranged through the platform after the job is done. Options will be communicated at the time of booking.",
  },
];

const WORKER_FAQS = [
  {
    q: "Who can register as a worker?",
    a: "Any individual with practical home-job skills — handymen, painters, plumbers (small jobs), gardeners, appliance repairers, electricians (minor work), and general DIY workers. You don't need a registered company to join.",
  },
  {
    q: "How do I register?",
    a: "Message the Plug-A-Pro WhatsApp number or fill in the web form. Tell us your name, what you do, which suburbs you cover, and your general availability. Your application is reviewed before you start receiving leads.",
  },
  {
    q: "How do leads work?",
    a: "When a customer job matches your skills and area, you receive a WhatsApp notification with the job category, suburb, and urgency. You accept or decline. If you accept, you get the full address and a platform message thread opens with the customer.",
  },
  {
    q: "What information does the customer see about me?",
    a: "Your name, rating, and any reviews from past jobs. Your personal phone number is not shown to the customer by default.",
  },
  {
    q: "How does quoting work?",
    a: "After accepting a lead, send a written quote through the app or WhatsApp — description, price, and timeline. The customer approves before any work starts. If the scope changes, log the extra work request and wait for approval before proceeding.",
  },
  {
    q: "How do I build my reputation?",
    a: "Every completed job adds a rating and optional comment from the customer. These appear on your profile and are visible to future customers when they're considering your quote.",
  },
  {
    q: "Is there a cost to join?",
    a: "Not at launch. We're in early access mode. Join now and we'll let you know how monetisation works before it affects you.",
  },
];

function FaqGroup({
  label,
  items,
}: {
  label: string;
  items: { q: string; a: string }[];
}) {
  return (
    <div className="mb-12">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
        {label}
      </p>
      <Accordion className="w-full">
        {items.map((faq, i) => (
          <AccordionItem key={i} value={`${label}-${i}`}>
            <AccordionTrigger>{faq.q}</AccordionTrigger>
            <AccordionContent>{faq.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

export default function FAQPage() {
  return (
    <div className="py-24 max-w-2xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-4 text-center">
        Frequently asked questions
      </h1>
      <p className="text-muted-foreground text-center mb-12">
        For customers looking for home-job help, and workers looking for local work.
      </p>
      <FaqGroup label="For customers" items={CUSTOMER_FAQS} />
      <FaqGroup label="For workers" items={WORKER_FAQS} />
    </div>
  );
}
```

- [ ] **Step 16.2: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 16.3: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add app/\(marketing\)/faq/page.tsx
git commit -m "content: rewrite FAQ — dual-audience questions for customers and workers"
```

---

## Task 17: Replace Pricing page with waitlist framing

**Files:**
- Modify: `app/(marketing)/pricing/page.tsx`

- [ ] **Step 17.1: Check if pricing page exists**

```bash
ls /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/app/\(marketing\)/pricing/page.tsx 2>&1
```

If the file does not exist, skip to step 17.3. If it exists, continue to step 17.2.

- [ ] **Step 17.2: Replace the pricing page**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = buildMetadata({
  title: "Pricing",
  description:
    "Plug-A-Pro is in early access. Join free — we'll let you know how pricing works before it affects you.",
});

export default function PricingPage() {
  return (
    <div className="py-24 max-w-xl mx-auto px-4 text-center">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
        Pricing
      </p>
      <h1 className="text-4xl font-bold mb-4">Free to join during early access</h1>
      <p className="text-muted-foreground mb-4">
        Plug-A-Pro is currently in early access. Customers can request help and workers can receive leads at no charge while we validate the platform.
      </p>
      <p className="text-muted-foreground mb-10">
        When we introduce monetisation — for providers, for customers, or both — we&apos;ll communicate it clearly before it takes effect. No surprises.
      </p>
      <div className="flex gap-4 justify-center flex-wrap">
        <Button nativeButton={false} render={<Link href="/waitlist" />} size="lg">
          Request help
        </Button>
        <Button
          nativeButton={false}
          render={<Link href="/for-workers" />}
          variant="outline"
          size="lg"
        >
          Register as a worker
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 17.3: Typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 17.4: Commit**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add app/\(marketing\)/pricing/page.tsx
git commit -m "content: replace pricing page with early-access / waitlist framing"
```

---

## Task 18: Final build verification

- [ ] **Step 18.1: Run full typecheck**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npx tsc --noEmit 2>&1
```

Expected: no errors. If there are errors, fix them before proceeding.

- [ ] **Step 18.2: Run build**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npm run build 2>&1 | tail -30
```

Expected: build completes with no errors. Type errors will fail the build.

- [ ] **Step 18.3: Start dev server for visual review**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing && npm run dev
```

Visit `http://localhost:3000` and verify:
- Homepage hero shows "Get home help in minutes — not weeks"
- "Request help" and "I want work →" CTAs are both present
- Nav shows "How it works | For workers | FAQ"
- No mention of "dispatch technicians" or "your business"
- No SaaS pricing section on homepage
- `/for-workers` page loads correctly
- `/how-it-works` shows dual customer + worker flows
- `/faq` shows two labelled sections (For customers / For workers)
- `/solutions` shows job categories (Handyman, Painting, Garden etc.)

- [ ] **Step 18.4: Final commit if any last-minute fixes were made**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing
git add -p
git commit -m "fix: final build and visual review corrections"
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec section | Tasks covering it |
|---|---|
| §3.3 Hero | Task 2 |
| §3.4 How It Works (3 steps) | Task 5 |
| §3.5 Problem Statement (dual) | Task 3 |
| §3.6 Who It's For (dual audience) | Task 4 |
| §3.7 Trust & Safety | Task 6 |
| §3.8 Operating Model (dual side) | Task 8 |
| §3.9 Pricing removed from homepage | Task 12, 17 |
| §3.10 Social Proof (consumer + provider) | Task 9 |
| §3.11 WhatsApp CTA | Tasks 2, 10 |
| §3.12 CTAStrip (dual) | Task 10 |
| §4.1 Navigation | Task 11 |
| §4.2 Homepage sections order | Task 12 |
| §4.3 /how-it-works | Task 13 |
| §4.3 /for-workers | Task 14 |
| §4.3 /faq dual-audience | Task 16 |
| §2 description | Task 1 |
| A10 Nav | Task 11 |
| A16 Remove /pricing SaaS tiers | Task 17 |

**Placeholder scan:** No TBD or TODO in plan code (metadata TODOs in siteConfig are pre-existing for real URLs, intentional).

**Type consistency:** All components use `React.ElementType` for dynamic icon refs where LucideIcon cannot be used. `LucideIcon` used for all static arrays typed as `LucideIcon`. `Button` API uses `nativeButton={false} render={<Link href="..." />}` consistently throughout.
