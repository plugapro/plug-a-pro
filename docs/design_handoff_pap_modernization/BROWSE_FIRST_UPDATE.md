# Update: Browse-first flow

> **Read this AFTER `README.md` but BEFORE building Home / Browse / Booking.**
> This supersedes the corresponding sections of `SCREENS.md`.

---

## The insight

WhatsApp's current onboarding shows the customer **who's available before asking them to commit**:

> what service? → what area? → here are 3 matched providers → pick one → confirmed → updates by WhatsApp.

The previous PWA design did the opposite — a category → address → details → submit form, then a silent server-side match. The customer had no idea who was going to show up, or whether anyone in their suburb was even available.

The redesign flips this:

> set area → browse / search → pick a provider → short request form → confirmed → updates by WhatsApp + in-app.

Everything in this document is in service of that one inversion.

---

## What's actually changed in the prototype

| Screen | Status | Source |
|---|---|---|
| **Home** | Rewritten | `screens-customer.jsx :: ScreenHome` |
| **Home · first-run** (no area set) | New variant of Home | same |
| **Area picker sheet** | New | `screens-customer.jsx :: ScreenAreaPicker` |
| **Browse** | Rewritten — area-aware, empty states | `screens-customer.jsx :: ScreenBrowse` |
| **Browse · empty area** | New empty state branch | `screens-customer.jsx :: BrowseEmpty` |
| **Provider profile** | "Request service" CTA now routes to **Book Quick** | `screens-customer.jsx :: ScreenProvider` |
| **Book — quick** (2-step, from provider) | New | `screens-book.jsx :: ScreenBookQuick` |
| **Book — blind / urgent** (4-step) | Existing flow, repurposed as the secondary "urgent" path | `screens-book.jsx :: ScreenBook` |

Everything else (Bookings, Account, Notifications, Auth, Internal, Status) is unchanged from the original handoff — those screens remain as-spec'd in `SCREENS.md`.

---

## Area: the new global concept

The user's **selected suburb** is now first-class app state. It threads through Home, Browse, and Booking.

### Data shape
```ts
type Area = {
  full: string;      // "Sandton, Sandhurst"  — what we show to the user
  primary: string;   // "Sandton"             — used for matching + display
  city?: string;     // "Johannesburg"        — for grouping in the picker
  source: 'geo' | 'manual' | 'inferred';   // for analytics
};
```

The prototype stores just the `full` string for brevity. Production should store the structured form so the matcher doesn't have to re-parse it.

### Storage & lifecycle
- Persist to `localStorage` under `pap:area`. Hydrate on app boot.
- On first run (no value), Home shows the **first-run state** that demands area selection before anything else.
- Expose `useArea()` (or equivalent) so any component can read/write it without prop-drilling.
- On sign-in, if the user has a saved area on their account, prefer that over local. Surface a single toast: "Using your saved area: {area}. Change".

### Setting area
Three entry points:
1. **"Use my current location"** in the Area Picker — calls geolocation API, reverse-geocodes to suburb. Permission denied? Fall back to manual.
2. **Suburb autocomplete** in the Area Picker — debounced calls to `GET /api/locations/suburbs?q=`. The prototype uses a hand-rolled `POPULAR_SUBURBS` list as fallback when query is empty.
3. **Re-tap the area chip** from Home / Browse — opens the same picker.

---

## API needs

These are new (or newly-prominent). Cross-reference with what already exists:

```
GET  /api/locations/suburbs?q=<query>            → autocomplete results
POST /api/locations/reverse?lat=&lng=            → suburb from coords
GET  /api/providers?area=&category=&q=&sort=     → list w/ filtering
GET  /api/providers/nearby?area=&limit=3         → home strip (top providers in area, ordered by availability + rating)
GET  /api/providers/:id                          → unchanged
POST /api/bookings                                → existing, but accept `providerId` field for direct-to-provider requests
POST /api/area-alerts                             → "Notify me when a provider joins {area} for {category}"
```

---

## Routing changes

Add these routes; the rest are unchanged:

```
/area                       — Area picker sheet (full-screen on mobile, modal sheet on desktop)
/providers?area=&category=  — Browse with filters applied
/book/from/:providerId      — Quick booking (2-step, provider-locked)
/book                       — Existing form, now repositioned as the "urgent / blind" path
```

The Home category tiles link to `/providers?category=<label>` (NOT to `/book` like before).

---

## Home — section-by-section

Use `Plug A Pro PWA.html → Home` as the visual reference; read this for behaviour + intent.

### 1. Header
Unchanged: logo + wordmark + notification bell. Bell deep-links to Notifications.

> **Wordmark**: render as plain text "Plug A Pro" — single span, normal letter-spacing. No gradient styling, no dot separators. Use whatever weight matches your H1 stack.

### 2. Area chip (PRIMARY — never hide)
Full-width 56px card at the top of the page (just below the header).

- **Has area**: pin icon on gradient-soft tile, eyebrow "LOOKING IN", suburb name, "Change ›" affordance on right.
- **No area** (first-run): pin icon on filled gradient tile, eyebrow "CHOOSE AN AREA TO START", placeholder "Tap to set your suburb", purple ring around the card to draw the eye, "Set ›" on right.

Tap → `/area` (full-screen picker sheet).

### 3. Hero H1
Short, area-aware:
- No area + signed-out: "Find trusted help, near you."
- Has area + signed-out: "Trusted help in {area.primary}."
- Signed-in: "Hi {firstName} — what needs fixing?"

26px / 700 / -0.6 letter-spacing, `text-wrap: balance`. No subtitle, no trust pill.

### 4. Unified search bar
Single search input + gradient "Search" button. Submits to `/providers?q=<input>&area=<area>`.

The previous design had a "Request" button here that bypassed browse — **don't bring that back**. It split the flow.

Disabled state when no area: placeholder is "Set an area to search" and the button opens the area picker.

### 5. Category grid (4×2)
Same 8 categories. Each tile routes to `/providers?category=<label>` (NOT to the booking form).

### 6. Provider strip — "Available near {area.primary}"
The **most important new element**. Three branches:

**Has area, ≥1 provider** (happy path):
- Section header: "Available near {area.primary}" + green online-count pill ("● 4 online") + "See all N →" link
- 2–3 ProviderCards (use existing component — already shows photo/initials, rating, jobs, area, fee, availability badge)
- If `matched.length > 3`, a thin "See all N in {area.primary} →" link-as-button under the cards

**Has area, 0 providers**:
- Single card, warn-tinted icon, copy:
  > "No providers in {area.primary} yet. Be the first to request — we'll match the closest available pro and notify you when more join."
- Two CTAs: **"Request anyway"** (primary → urgent booking form) and **"Change area"** (secondary → area picker)

**No area set** (first-run):
- Single card, gradient-soft icon, copy:
  > "Set your area to see providers. We'll show you who's working in your suburb right now."
- One CTA: **"Choose suburb"** → area picker

### 7. Urgent CTA (secondary)
Below the provider strip. **Only shown when area is set.**

Card with zap icon (danger-tinted), title "Need help right now?", subtitle "Skip browsing — we'll match the closest available pro." Taps to `/book` (the existing 4-step urgent flow).

Keep it subordinate to the browse path — same size as the other cards, not a giant gradient banner.

### 8. How it works
Unchanged.

### 9. For service providers CTA
Unchanged.

### 10. Footer
Unchanged.

---

## Area Picker — `/area`

Full-screen sheet. Close button (X) on top-left returns to wherever the user came from (Home or Browse).

### Layout
1. **Header** — close X, eyebrow "SERVICE AREA", title "Where do you need help?"
2. **Subhead** — "We use your suburb to match nearby providers. Your full address only unlocks after a provider accepts."
3. **Search input** — autofocus, suburb autocomplete (debounce 200ms). Leading search icon.
4. **"Use my current location"** — secondary button, pin icon.
5. **Results card** — either:
   - Empty query: "Popular areas" header + curated list (Sandton, Rosebank, Bryanston, Allen's Nek, Randburg, Centurion, Pretoria East, Soweto, Sea Point, Constantia, Umhlanga)
   - With query: "Matches" header + filtered results
   - 0 matches: "No matches for '{q}'. Try a wider search or use your current location."

   Each row: 36×36 pin tile + suburb name + city subtitle + chevron. **Selected row** uses gradient-soft bg + purple text + check icon instead of chevron.
6. **Privacy footnote** — gradient-soft card, lock icon, "We never share your full address upfront. Providers only see your suburb until you accept their quote."

### Behaviour
- Selecting a row immediately persists area + returns to the previous screen (Home or Browse). No "Confirm" button.
- "Use my current location" requests geolocation. On success → reverse-geocode → set area. On error/deny → toast "Couldn't read your location. Search instead." (no modal).
- The picker is also reachable directly via the screen picker for design review.

---

## Browse — `/providers`

Same core layout as before (header, search, category pills, list), with three structural changes:

### 1. Area chip in the toolbar row
Below the H1, render a row containing:
- **Area chip** (gradient-soft, pin icon, suburb name, chevron) — taps to `/area`
- **Result count** — "12 providers · Plumbing"

This is the persistent reminder of the area filter. Without it, customers don't know why the list is short.

### 2. Filters apply in this order
`area` (suburb match on `provider.area`) → `category` (exact match on `cats[]`) → `q` (substring on name / cats / bio).

If the URL has `?area=` it overrides the localStorage value for that visit but doesn't persist.

### 3. Three distinct empty states

Render the matching one — copy and CTAs differ:

```
no area set:
  icon: pin (gradient-soft)
  title: "Choose an area first"
  body:  "Set your suburb and we'll show pros working near you."
  CTA:   "Choose area" → /area

no providers in area at all:
  icon: alert (warn-tinted)
  title: "No providers in {area} yet"
  body:  "You're early — be the first to request and we'll match the
          closest available pro. We'll also notify you when a provider
          joins your area."
  CTAs:  primary "Request anyway"  → /book?area={area}
         secondary "Notify me"      → POST /api/area-alerts

no providers in area for THIS category:
  icon: alert (warn-tinted)
  title: "No {category} providers in {area}"
  body:  "Try a different category, or request the service anyway —
          we'll match someone who covers this work."
  CTAs:  primary "Request anyway"  → /book?category={category}&area={area}
         secondary "Show all"      → clears the category filter
```

---

## Booking — two flows

### Quick (`/book/from/:providerId`) — preferred path
2-step. Reached from a provider profile or from the home strip.

**Header**: back button, eyebrow "REQUEST · STEP X OF 2", title (per step).

**Provider context strip**: sticky-feeling card under the stepper showing the locked-in provider (avatar, name, verified badge, rating + job count, availability chip).

**Step 1 — "Tell us about it"**:
- Job title (single line)
- Detail textarea (280 char counter)
- When? — segmented 3-up (Today / Within 48h / This week) with hue-tinted icons
- Photos — 3 slot placeholders, tap to add
- Address section — area card pinned at top (suburb is already known), then a single-line street input, then unit + complex on a 2-up grid. The street/unit/complex are optional in the UI; required server-side only after acceptance.
- Privacy footnote under the CTA: "🔒 Your exact address is only shared once {firstName} accepts."

**Step 2 — "Review"**:
- "Going to" card with provider mini
- "Job" card with title, description, category chip + urgency chip + photo-count chip
- "Location" card with address (suburb bold, the rest faint) + privacy lock note
- CTA: "Send to {firstName}"

On submit: same as the existing 4-step → `/book/submitted` (Request received screen).

### Urgent / blind (`/book`) — secondary path
The previous 4-step flow (Category → Address → Details → Review). Unchanged in structure, but **only reached from**:
1. The "Need help right now?" CTA on Home
2. The "Request anyway" CTAs on Browse empty states

Reposition it in the UI as the **urgent path** — copy on the entry CTAs should signal that the system matches them with whoever is closest/available, not that the user is picking.

---

## Persistence summary

| What | Where | Key |
|---|---|---|
| Selected area | `localStorage` | `pap:area` |
| Recently selected suburbs | `localStorage` | `pap:area:recent` (cap 5) |
| In-progress booking draft | `localStorage` (clear on submit / leave) | `pap:booking:draft` |
| Auth (existing) | Existing | unchanged |

---

## What NOT to do

- ❌ Don't bring back the "Request" button inside the search bar that routed to the form. It split the flow.
- ❌ Don't show category tiles or a search input until area is set in the first-run state. Show the area card and one CTA only — anything else trains the user that area is optional.
- ❌ Don't make the urgent CTA visually compete with the browse path. It's secondary by design.
- ❌ Don't auto-fill an area without user consent. Even geolocation must be opt-in via "Use my current location".
- ❌ Don't render an empty provider list with no explanation. Always one of the three empty states above.

---

## Open questions for the team

1. **Provider availability data** — the prototype uses a simple `available` boolean + `online` boolean. How is "available right now" defined for real? Last-seen heartbeat? Calendar slot? Confirm before the home strip ships.
2. **Geo-reverse-geocode** — which provider? Google / Mapbox / OpenStreetMap? Cost & accuracy implications.
3. **Notify-me alerts** — confirm we have the channel + schedule to deliver them (push + WhatsApp template?) before exposing the CTA.
4. **Default sort** in browse — currently "Rating". Should we surface "Distance from you" once we have lat/lng? Worth A/B testing.
