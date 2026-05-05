# Plug A Pro Marketing Site — QA Checklist

Date: 2026-03-27

## Build & Type Checks

- [ ] `npx tsc --noEmit` passes with no new errors
- [ ] `next lint` passes with no warnings
- [ ] `next build` completes without errors

## Cleaning Services Removal

- [ ] `/solutions` page: Cleaning Services entry not visible
- [ ] Homepage (`WhoItsFor`): Cleaning Services card not visible
- [ ] Solutions page metadata: no "cleaning" in description
- [ ] `grep -ri "cleaning" app/ components/` returns no marketing-facing cleaning references

## Home Maintenance & DIY Positioning

- [ ] `/solutions` page: General Home Maintenance is first entry
- [ ] `/solutions` page: Home Maintenance points include DIY completion language
- [ ] `/solutions` page: DIY callout card visible below solutions grid
- [ ] Homepage (`WhoItsFor`): DIY Project Help card visible (Hammer icon)
- [ ] Hero: DIY mention visible with link to /solutions
- [ ] FAQ: DIY completion question present

## Visual / Icons

- [ ] `WhoItsFor`: 6 Lucide icons visible (Wrench, Zap, Wind, Home, Lock, Hammer), no emoji
- [ ] `Features`: 6 Lucide icons visible, no generic placeholders
- [ ] `ProblemStatement`: 4 Lucide icons visible (ClipboardList, Phone, FileSpreadsheet, MapPin), no emoji
- [ ] Solutions page: Lucide icons per category, no emoji
- [ ] Icon containers consistent: bg-muted + accent-brand colour
- [ ] Hero: dot-grid background visible (subtle) in light mode
- [ ] Hero: dot-grid background visible in dark mode

## Content Accuracy

- [ ] siteConfig.name renders as "Plug A Pro" throughout
- [ ] Nav logo shows "Plug A Pro"
- [ ] Nav links: Solutions, How it works, Pricing
- [ ] Hero H1: "Book a technician in minutes — via WhatsApp"
- [ ] Pricing tiers: Starter R 999/mo, Growth R 2 499/mo, Enterprise Custom
- [ ] Testimonials: field service specific (not generic startup copy)
- [ ] FAQ: 9 real questions
- [ ] About: real mission copy (no "Replace this with..." text)

## Accessibility

- [ ] All icon-only elements have `aria-hidden="true"`
- [ ] Section headings follow H1 → H2 → H3 hierarchy per page
- [ ] Links have descriptive text (no bare "click here")
- [ ] Buttons have descriptive labels

## SEO

- [ ] `<title>` on homepage reflects "Plug A Pro"
- [ ] Meta descriptions are meaningful (not placeholder)
- [ ] Solutions page metadata does not mention cleaning

## Mobile Responsiveness

- [ ] Homepage renders on 375px wide viewport
- [ ] `WhoItsFor` 2-column grid on mobile, 3-column on md+
- [ ] Hero text doesn't overflow on small screens
- [ ] Pricing cards stack on mobile

## Items Needing Human Review

- [ ] `siteConfig.whatsappNumber`: replace "+27000000000" with real number
- [ ] `siteConfig.url`: replace "https://plugapro.co.za" with production URL
- [ ] `siteConfig.links.app`: replace with production app URL
- [ ] Pricing tiers (R 999/R 2 499): confirm amounts with stakeholders
- [ ] About page: add real team bios and photos when available
- [ ] SocialProof: replace placeholder testimonials with real customer quotes when available
