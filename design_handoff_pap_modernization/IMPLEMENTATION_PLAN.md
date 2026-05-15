# Implementation plan

Suggested sequencing for Claude Code. Each phase is independently shippable.

---

## Phase 0 — Foundations (1 PR)

Land the design tokens and primitives. No user-visible changes yet.

1. Add Plus Jakarta Sans + DM Mono via your chosen mechanism (next/font, link tag, self-hosted, etc.)
2. Create a `tokens.{ts,js,scss,css}` module with the values from `DESIGN_SYSTEM.md`. Light + dark variants.
3. Add the brand gradient as a reusable utility (`.brand-gradient` class or a `BrandGradient` component) so it can be applied to text via `background-clip: text` and to backgrounds the same way.
4. Wire `prefers-color-scheme` (or your existing theme provider) to switch token sets.
5. Build the **primitives** in your component lib:
   - Button (7 variants)
   - Input + FieldLabel + PhoneInput + OTPInput
   - Card (flat / raised)
   - Chip (6 tones)
   - SectionLabel
   - Stepper
   - StatusDot
   - Avatar (gradient initials + photo fallback)
   - BottomNav
   - Toast

Storybook / Ladle stories for each primitive showing all states.

---

## Phase 1 — Customer auth flow (1 PR)

Smallest end-to-end loop with real value.

1. Sign in (`/auth/sign-in`)
2. Verify OTP (`/auth/verify`) with role param
3. Sign up (`/auth/sign-up`)
4. Link expired (`/auth/expired`)

Wire OTP request + verification against existing API. Persist auth as your codebase already does. WhatsApp deep-link uses `wa.me/<intl-number>?text=<msg>` — confirm the number with the team.

---

## Phase 2 — Area system + Customer core (2 PRs)

> **Required reading before this phase: `BROWSE_FIRST_UPDATE.md`.** It redefines Home, Browse, and the booking entry points.

**PR 2a — Area foundations**
1. Suburb autocomplete API (`GET /api/locations/suburbs?q=`) + reverse-geocode (`POST /api/locations/reverse`).
2. `useArea()` hook + `localStorage` persistence (`pap:area`, `pap:area:recent`).
3. **Area picker sheet** (`/area`) — full-screen on mobile, modal on desktop.

**PR 2b — Customer core**
1. Bottom navigation shell (Home, Browse, Bookings, Account)
2. **Home** (`/`) — area chip first, unified search, category grid, **"Available near {area}" provider strip**, urgent shortcut, how-it-works. Includes the first-run state for no area set.
3. **Find a provider** (`/providers?area=&category=&q=`) — area-aware list with three distinct empty states (no area / no providers in area / no providers in category).
4. Provider profile (`/providers/:id`) — "Request service" CTA routes to the quick booking flow.
5. Account (`/account`) — signed-in & signed-out.

API: list providers w/ area + category + q filters; nearby providers for the home strip; provider detail; user profile; area alerts ("notify me when a pro joins {area}").

---

## Phase 3 — Booking flows (1 PR)

Two distinct paths into booking. See `BROWSE_FIRST_UPDATE.md` for the full breakdown.

1. **Book · quick** (`/book/from/:providerId`) — 2-step flow when the provider is pre-selected. **This is the primary path.**
2. **Book · urgent / blind** (`/book`) — the existing 4-step form, now repositioned as the secondary path reached from "Need help right now?" and from browse empty-state CTAs.
3. Request sent (`/book/submitted`) — shared confirmation screen.
4. My bookings list (`/bookings`).

API: `POST /api/bookings` accepts an optional `providerId` for direct-to-provider requests; the urgent path omits it and goes through the existing matcher.

Extend with: **Booking detail screen** — follow Recipe A in `APPLYING_TO_OTHER_SCREENS.md`. Don't wait for a mock.

---

## Phase 4 — Provider flows (1–2 PRs)

1. Provider sign in (`/provider/sign-in`)
2. Provider dashboard (`/provider`) — credits hero, stats, availability toggle, leads, in-progress
3. Lead detail / acceptance — follow Recipe A
4. Top-up flow — follow Recipe C + selector pattern
5. Provider profile editor — follow Recipe C

---

## Phase 5 — Internal & utility (1 PR)

1. Admin sign in (`/admin/sign-in`)
2. Admin operations (`/admin`) — KPIs, queue, systems
3. Service status (`/status`)
4. Credit terms (`/credit-terms`)
5. Notifications (`/notifications`)
6. 404 / generic error

---

## Phase 6 — Polish (1 PR)

1. Motion: screen enter, button press feedback, stepper transitions. Respect `prefers-reduced-motion`.
2. Loading skeletons for every fetch (mirror the loaded shape).
3. Empty states for every list.
4. Error states for every fetch.
5. PWA manifest + install prompt UX.
6. Accessibility pass — axe / Lighthouse.

---

## After this is done

Use `APPLYING_TO_OTHER_SCREENS.md` recipes to bring **every remaining screen** in the codebase into the same language without a fresh design pass:

- Booking detail / job tracking → Recipe A
- Quote / offer view → Recipe A
- Rating & review → custom but composed of primitives
- Provider verification queue (admin) → Recipe B
- Dispute detail (admin) → Recipe A
- Settings sub-pages → Recipe C
- 404 / generic error → Empty state recipe

Run the checklist at the bottom of `APPLYING_TO_OTHER_SCREENS.md` before opening each PR.

---

## Branch / PR naming

Keep PRs scoped to a phase. Suggest:
```
design/foundations
design/customer-auth
design/customer-core
design/booking-flow
design/provider-flows
design/internal-utility
design/polish
```

Each PR should reference this README and the `SCREENS.md` sections it implements.
