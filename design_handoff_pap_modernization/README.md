# Handoff: Plug A Pro PWA — Modern UI Redesign

> **Read first.** The files in `prototype/` are an HTML/React design reference — not production code to copy into the app verbatim. Your job is to **reproduce these designs in the Plug A Pro PWA's existing codebase**, using its established framework, component library, state, and routing. If the codebase doesn't have an opinion on something (icon set, animation), pick a sensible existing pattern over inventing a new one.

---

## Overview

This handoff covers a full modernisation of the Plug A Pro PWA. The redesign keeps the existing **familiar patterns** (OTP via WhatsApp, suburb-only address until acceptance, provider portal, admin portal, credits, status page) but lifts the visual language to a calmer, more trustworthy system with the brand gradient used as accent only.

**Fidelity: High-fidelity.** Colours, type, spacing, radii and copy are all spec'd. Recreate pixel-perfectly using the codebase's existing component library — only fall back to custom CSS where the lib lacks the primitive.

---

## What's in this pack

| File | Purpose |
|---|---|
| `README.md` | This document — start here |
| **`CLAUDE_CODE_PROMPT.md`** | Copy-paste kickoff prompt for Claude Code. |
| **`BROWSE_FIRST_UPDATE.md`** | **⚠️ Read second.** Captures the browse-before-commit redesign of Home / Browse / Booking and supersedes the related sections of `SCREENS.md`. |
| `DESIGN_SYSTEM.md` | Tokens, components, patterns — the whole vocabulary |
| `SCREENS.md` | Screen-by-screen breakdown with copy, layout, states |
| `APPLYING_TO_OTHER_SCREENS.md` | Recipes for screens that exist in the codebase but **not** in this prototype (booking detail, quote, profile edit, dispute, etc.) |
| `IMPLEMENTATION_PLAN.md` | Suggested order of work for Claude Code |
| `prototype/` | The HTML/React prototype. Open `Plug A Pro PWA.html` to inspect any screen interactively |
| `prototype/assets/logo.png` | Brand mark |

---

## How to read the prototype

1. Open `prototype/Plug A Pro PWA.html` in a browser.
2. Use the **screen picker** on the left to jump between all 17 screens.
3. The **Tweaks** panel is for design exploration only — light/dark, density, palette, radius, WhatsApp toggle. The production build should respect light/dark from the OS / user setting; the other tweaks are not user-facing.
4. The phone frame is purely a presentation device. The actual PWA fills the viewport.

Source files of interest:
- `tokens.jsx` — exact token values (colors, density, radii)
- `icons.jsx` — full icon vocabulary
- `ui.jsx` — every shared primitive (Button, Input, PhoneInput, Card, Chip, OTPInput, BottomNav, etc.) with all states
- `screens-*.jsx` — one file per screen group; each screen function shows full markup, copy, validation, and interactions

---

## Scope

### Screens in this prototype (22)

**Customer**
- Home (area set)
- Home · first run (no area set)
- Area picker sheet — suburb autocomplete
- Find a provider (Browse)
- Browse · empty area state
- Provider profile
- Book · quick (from provider) — 2 steps
- Book · urgent (blind) — 4 steps (Category, Address, Details, Review)
- Confirmation ("Request received")
- My bookings (list)
- Account
- Notifications

**Auth & access**
- Customer sign in (WhatsApp OTP)
- Verify OTP (reused for customer + provider with `role` payload)
- Sign up
- Link expired
- Provider sign in
- Admin sign in

**Internal**
- Provider dashboard (credits, leads, in-progress)
- Admin operations
- Service status (public)
- Credit terms (provider doc)

### Screens NOT in the prototype

These exist in the codebase but were not redrawn. **Use `APPLYING_TO_OTHER_SCREENS.md` to bring them into the same design language** — recipes are given for each common screen archetype (list, detail, form, status, empty state, etc.).

Examples likely in the codebase but not redrawn:
- Booking detail / job tracking screen
- Quote / offer view (customer accepting a provider's quote)
- Rating & review screen
- Provider profile editor
- Provider job acceptance / decline detail
- Top-up / credit purchase flow
- Admin dispute detail
- Admin provider verification queue
- 404 / generic error
- Onboarding tour screens
- Settings sub-pages (notifications, addresses, privacy, payment methods)

---

## Implementation notes

- **Framework**: Replicate using whatever the Plug A Pro PWA already uses (React + Vite, Next.js, etc.). The prototype is plain React + Babel for portability.
- **Styling**: The prototype uses inline styles for clarity. Translate to the codebase's styling solution (CSS Modules, Tailwind, styled-components, vanilla-extract). Token values are in `DESIGN_SYSTEM.md`.
- **Icons**: The prototype ships its own line icons. If the codebase uses Lucide / Phosphor / Heroicons, use those — map per the table in `DESIGN_SYSTEM.md`.
- **Fonts**: Plus Jakarta Sans (UI) + DM Mono (codes, references). Both Google Fonts.
- **Routing**: Screen names align to expected routes (e.g. `/`, `/browse`, `/providers/:id`, `/book`, `/bookings`, `/account`, `/auth/sign-in`, `/auth/verify`, `/provider`, `/admin`, `/status`, `/credit-terms`). Adjust to match.
- **WhatsApp**: Visual prominence is intentional — keep the WhatsApp green colour + glyph wherever the channel is being used (OTP, lead notifications, support, customer-provider chat). Hide entirely if the WhatsApp integration is disabled per environment flag.

---

## Brand & assets

- Use `prototype/assets/logo.png` for the mark.
- **Wordmark**: render as plain text "Plug A Pro" (with spaces between the words — no gradient, no separators). Use `ui.jsx::Wordmark` as reference.
- Gradient: `linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)`.
- Gradient is for: primary CTAs, the wordmark accents, brand badges/eyebrows, focused field outlines, and decorative haloes only. **Never** as a screen background.

---

## Open questions (please confirm before building)

1. Light/dark — does the existing codebase already respect `prefers-color-scheme`, or do we add a setting?
2. WhatsApp on/off — is there an environment flag that should drive whether WA-styled elements show?
3. Icon library — Lucide preferred? (the prototype ships custom; happy to convert)
4. Density — assume `cozy` only in production, or expose density as a setting?

---

Questions? See the per-screen breakdown in `SCREENS.md`, the systematic vocabulary in `DESIGN_SYSTEM.md`, or extension recipes in `APPLYING_TO_OTHER_SCREENS.md`.
