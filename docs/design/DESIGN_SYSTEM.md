# Plug A Pro — Design System

A premium, mobile-first dark visual system that the customer and provider PWAs share. Inspired by high-end consumer hardware UIs: near-black surfaces, soft elevated cards, restrained accents, high-contrast type, refined shadows, generous spacing.

## Visual direction

- **Surfaces** — near-black background with gently elevated cards. No splash-page gradients on app screens.
- **Type** — Geist Sans, tight tracking on headings (`-0.015em`), antialiased.
- **Borders** — soft translucent hairlines (`rgba(255,255,255,0.08)`) rather than solid grey.
- **Shadows** — depth via dark drop-shadows + a 1px inner highlight, never sparkle.
- **Motion** — short, calm transitions on color/border. Honour `prefers-reduced-motion`.
- **Trust** — verified badges, ratings, and rates are surfaced at card level. We never fabricate marketplace data.

## Tokens

Tokens live in `field-service/app/globals.css`. **Always use CSS custom properties or shadcn token utilities (`bg-card`, `text-foreground`, `border-border`, …) — do not hardcode hex values in screens.**

### Colour
| Role | CSS var | Tailwind |
|---|---|---|
| Background | `--background` | `bg-background` |
| Foreground (text) | `--foreground` | `text-foreground` |
| Card surface | `--card` | `bg-card` |
| Elevated surface | `--surface-elevated` | (use class `app-shell-panel`) |
| Subtle surface | `--surface-subtle` | `bg-muted` |
| Muted text | `--muted-foreground` | `text-muted-foreground` |
| Primary action | `--primary` | `bg-primary text-primary-foreground` |
| Border | `--border` | `border-border` |
| Ring (focus) | `--ring` | `ring-ring` |

### Semantic tones
Six tone families — neutral, info, success, warning, danger, brand — each with `bg`, `border`, and `fg`. Use them via:

- The `tone-{name}` utility class (sets all three properties at once)
- The `Badge` variant (`<Badge variant="success">`)
- The `AlertCallout` component (`<AlertCallout tone="warning">`)

Never reach for raw `bg-emerald-50`, `bg-amber-50`, `text-green-600`. They look cheap on dark and are not theme-aware.

### Radius
`--radius-sm 0.5rem` · `--radius-md 0.75rem` · `--radius 0.875rem` (default) · `--radius-lg 1rem` · `--radius-xl 1.25rem` · `--radius-2xl 1.5rem`. Cards use `rounded-2xl`. Buttons use `rounded-xl`. Pills use `rounded-full`.

### Shadows
- `--shadow-soft` — default card lift
- `--shadow-float` — modals, popovers
- `--shadow-pop` — tap-feedback / elevated CTA

## Components

All shared components live in `field-service/components/shared/` and are imported as `@/components/shared/<Name>`.

| Component | Purpose |
|---|---|
| `PageHeader` | eyebrow + title + description + action slot |
| `ActionBar` | sticky bottom action bar for flows |
| `EmptyState` | "no data" placeholder with icon + CTA |
| `ErrorState` | failed-load placeholder with retry |
| `Skeleton`, `CardSkeleton`, `ListSkeleton`, `StatGridSkeleton` | loading shapes |
| `StatCard` | KPI tile (label + value + tone chip) |
| `AlertCallout` | tone-aware callout (replaces inline emerald/amber/blue boxes) |
| `MoneyInput` | ZAR currency input with decimal keypad |
| `FormField` | label + control + hint/error scaffolding (render-prop) |
| `CompletionMeter` | profile-completeness / onboarding bar |
| `ProviderCard` | trust-signal-rich provider card (customer-facing) |
| `JobCard` | operational job card (provider-facing) |
| `StatusBadge` | polymorphic status pill — covers Job / Booking / Match / JobRequest / Quote enums |

shadcn primitives (`Button`, `Card`, `Input`, `Textarea`, `Select`, `Badge`, `Dialog`, `Tabs`, …) live in `components/ui/` and are extended with our tokens via CVA. Always import from `@/components/ui/*`.

## Mobile rules

- Every interactive element ≥ 44 × 44 px (enforced globally in `globals.css`).
- Page containers cap at `max-w-lg` (≈ 32rem) on phones.
- Sticky headers (`app-shell-header`) and bottom nav (`app-bottom-nav`) use frosted glass over `--background`. Always pair with `safe-top` / `safe-bottom`.
- Use `viewportFit: cover` so safe-area insets work on notched iPhones (set in `app/layout.tsx`).
- Sticky bottom action bars (`ActionBar`) sit *above* the bottom nav and below the keyboard. Use only on flow screens — never on list screens.
- Bottom-nav active state must be visually distinct beyond colour (a top dot is added — see `AppNavLink`).

## Forms

- Use `FormField` to wire labels, hints, and errors with proper aria attributes.
- Use the right `inputMode` and `autocomplete` for mobile keyboards (`numeric`, `email`, `tel`, `decimal`).
- Use `MoneyInput` for ZAR amounts so digits get the numeric keypad and a fixed `R` prefix.
- Validate on the server with Zod; surface errors inline through `FormField`'s `error` prop.
- For submit buttons that perform a server action, wrap with `useFormStatus` and disable while pending.

## Accessibility expectations

- Contrast ≥ 4.5 : 1 for body text, ≥ 3 : 1 for large text. Foreground `#f4f5f7` on `#050608` is ~ 18 : 1.
- Focus rings come from `--ring`; do not strip them.
- Never communicate state with colour alone — pair with text, icon, or shape.
- Use semantic HTML (`<button>`, `<a>`, `<header>`, `<nav>`) before ARIA. Use ARIA only when there's no semantic equivalent.
- Modals/drawers (Radix `Dialog`) handle focus trap automatically — keep using shadcn primitives, don't roll your own.
- Honour `prefers-reduced-motion`. The base layer kills non-essential animation already.

## Customer vs provider UX principles

**Customer**
- Decision-first surface area — every list item and provider card should help the user pick.
- Trust signals (verified, rating, completed jobs, suburb, rate) ride on `ProviderCard`.
- Pricing must be unambiguous (R amount + "excl. materials" qualifier).
- Booking and quote actions live in a sticky bottom `ActionBar` on flow steps.
- Never block on a blank screen — every fetch boundary has a `loading.tsx` skeleton and an `EmptyState` for the no-data path.

**Provider**
- Operational-first surface area — at every step the provider should see status, customer, location, time, price, and next action.
- Profile completeness (`CompletionMeter`) sits prominently on the dashboard so providers know what to fix.
- Credit balance and lead-cost surface above the fold; low-credit warning is an `AlertCallout`.
- Job cards show the next-action affordance; status colours come from `StatusBadge`.
- Forms tolerate slow connections — disable the button on submit, show a clear pending label.

## Anti-patterns to avoid

- Hardcoded hex / `bg-emerald-50` / `bg-amber-50` / `bg-blue-50` / `text-green-600` in screens.
- One-off card styles per page — extract into a shared component instead.
- Tiny tap targets (< 44 × 44 px) or near-edge controls without padding.
- Decorative gradients that fight content.
- Empty page states with no clear next step.
- Communicating status with colour alone (always include label + icon).
- `--no-verify` git commits to bypass lint/type errors.

## Where to look

- Tokens: `field-service/app/globals.css`
- Layout chains: `field-service/app/(customer)/layout.tsx`, `field-service/app/(provider)/layout.tsx`
- Shared components: `field-service/components/shared/*`
- shadcn primitives: `field-service/components/ui/*`
- shadcn config: `field-service/components.json`
