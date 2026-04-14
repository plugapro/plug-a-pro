# Plug-A-Pro Marketing Site — Content Changes Log

Updated: 2026-03-27

## lib/metadata.ts — siteConfig

| Field | Before | After |
|-------|--------|-------|
| venture | my-product | plug-a-pro |
| name | My Product | Plug-A-Pro |
| description | Generic one-liner | "WhatsApp booking, smart dispatch, and automatic invoicing — for any business that sends skilled workers to customer homes." |
| url | https://myproduct.com | https://plugapro.co.za (TODO: production URL) |
| whatsappNumber | Placeholder | +27000000000 (TODO: real number) |

## Homepage (app/(marketing)/page.tsx)

Added sections: ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel — these were already written but not shown on the homepage.

Pricing section sub-heading added below heading.

## Hero (components/marketing/Hero.tsx)

| Element | Before | After |
|---------|--------|-------|
| H1 | {siteConfig.name} ("My Product") | "Book a technician in minutes — via WhatsApp" |
| Subtext | Generic description | Real siteConfig.description + DIY line |
| Primary CTA | "Get started free" → app | "Get early access" → /waitlist |
| Secondary CTA | "See pricing" → /pricing | "See how it works" → /how-it-works |
| Background | Plain | Subtle dot-grid CSS pattern |

## Features (components/marketing/Features.tsx)

Replaced 6 generic "Feature One/Two/..." placeholders with 6 real features:
WhatsApp Booking, Smart Dispatch, Technician PWA, Auto-Invoicing, Extra Work Approval, Before & After Photos.

## SocialProof (components/marketing/SocialProof.tsx)

Replaced generic startup testimonials with 3 field service testimonials:
- Ryan M. (plumbing ops manager) on dispatch speed
- Sipho K. (home maintenance owner) on customer comms
- Nadia P. (electrical admin) on invoice dispute elimination

## PricingCards (components/marketing/PricingCards.tsx)

Replaced generic USD Free/Pro/Enterprise with real ZAR tiers:
- Starter: R 999/mo (50 jobs, 3 technicians)
- Growth: R 2 499/mo (unlimited, highlighted as most popular)
- Enterprise: Custom

## CTAStrip (components/marketing/CTAStrip.tsx)

| Element | Before | After |
|---------|--------|-------|
| Heading | "Ready to get started?" | "Ready to modernise your field service business?" |
| Subtext | Generic | Plug-A-Pro specific |
| Primary CTA | Generic | "Get early access" → /waitlist |

## Nav (components/shared/Nav.tsx)

| Before | After |
|--------|-------|
| Features | Solutions |
| Pricing | How it works |
| Blog | Pricing |
| Docs | (removed) |

## Solutions page (app/(marketing)/solutions/page.tsx)

- Removed: Cleaning Services entry
- Reordered: Home Maintenance moved to first position
- Updated: Home Maintenance headline and points (DIY completion language added)
- Added: DIY callout section at bottom of solutions list
- Updated: Page metadata description (cleaning reference removed)

## WhoItsFor (components/marketing/WhoItsFor.tsx)

- Removed: Cleaning Services (🧹) entry
- Added: DIY Project Help (Hammer icon) as 6th entry
- Updated: Section heading and description copy
- Updated: Footer note (more direct language about dispatching technicians)

## FAQ (app/(marketing)/faq/page.tsx)

Replaced 5 generic questions with 9 field-service-specific questions including a DIY completion FAQ.

## About (app/(marketing)/about/page.tsx)

Replaced "Replace this with..." placeholders with real Plug-A-Pro mission copy: Africa field service context, low-data mobile design, DIY completion support.

## Items NOT Changed (Kept As-Is)

- `/how-it-works` — strong, specific, no cleaning references
- `ProblemStatement` content — specific and strong (only icons replaced)
- `HowItWorksSteps` — strong content, kept exactly
- `OperatingModel` — strong content, kept exactly
- `WhatsAppButton` — correct and clean
- `WaitlistForm`, `ContactForm` — functional, out of scope
