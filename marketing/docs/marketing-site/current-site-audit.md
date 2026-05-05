# Plug A Pro Marketing Site — Current Site Audit

Conducted: 2026-03-27

## Site Structure

| Route | Component | Status |
|-------|-----------|--------|
| `/` | Hero, Features, SocialProof, PricingCards, CTAStrip | Mostly generic template — ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel existed but were unused on homepage |
| `/solutions` | Solutions page | Good Plug A Pro content, Cleaning Services present, emoji icons |
| `/how-it-works` | Full flow detail | Strong, specific, no cleaning references — kept as-is |
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

### Cleaning Services (removed)
- `app/(marketing)/solutions/page.tsx` — solution card (🧹 Cleaning Services)
- `components/marketing/WhoItsFor.tsx` — industry card (🧹 Cleaning Services)
- `app/(marketing)/solutions/page.tsx` metadata description: mentioned "cleaning"

### Generic/Weak Visuals
- All service categories used emoji icons (🔧⚡🧹❄️🏠🔑)
- ProblemStatement used emoji icons (📋📞🗂️📍)
- No category-specific visual treatment
- `lucide-react` was already installed but unused in these components

### CSS Gaps
- `--accent-pink` used in HowItWorksSteps but not defined in globals.css
- `--accent-green-wa` used in OperatingModel but not defined in globals.css

### Homepage Structure
- Homepage did not use: ProblemStatement, WhoItsFor, HowItWorksSteps, OperatingModel
- These were the strongest, most specific components in the codebase
- Homepage only showed: Hero (generic) + Features (generic) + SocialProof (generic) + Pricing (generic) + CTA

### Navigation
- Nav links were: Features, Pricing, Blog, Docs
- No link to Solutions or How it works

## Changes Made
See: `docs/marketing-site/content-changes.md`
