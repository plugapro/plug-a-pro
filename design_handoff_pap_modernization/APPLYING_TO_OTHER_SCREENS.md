# Applying the design language to other screens

You'll have screens in the codebase that weren't redrawn in the prototype. This doc gives you **patterns and recipes** so any new or existing screen can be brought into the same visual language without coming back for more mocks.

> **Golden rule**: when in doubt, copy the closest screen in `prototype/`. Don't invent a new pattern when an existing one works.

---

## The vocabulary (memorise these)

| Concept | How we render it |
|---|---|
| Brand moment | Logo gradient. Used on primary CTAs, brand wordmark, gradient haloes, verified badge, focused input outlines |
| Trust / safety | Shield glyph, gradient-soft card, "your details stay private" copy |
| WhatsApp channel | `#25D366` background or `rgba(37,211,102,0.12)` tint. WhatsApp glyph. Always next to a clear label |
| Reference / code | DM Mono, `inkSoft` colour, `PAP-####` format |
| Status | Coloured dot with `0 0 0 4px <tone>22` halo |
| Hierarchy: section | Eyebrow (uppercase 11/700, `inkMute`) above a section |
| Hierarchy: callout | Card with gradient-soft bg, no shadow, no border |
| Empty state | Centred icon tile (gradient-soft) + title (17/700) + body (13/500) + CTA |
| Destructive action | Danger red, only on the action itself (not its container) |
| Iconography | Line, 1.6px stroke, 20×20 box |

---

## Universal layout grid

```
┌─────────────────────────┐
│  status bar safe (54)   │
├─────────────────────────┤
│  header strip (44–60)   │  ← back btn / title / right action
├─────────────────────────┤
│                         │
│  scroll content         │
│  18px horizontal pad    │
│  18–24px between        │
│  sections (cozy)        │
│                         │
├─────────────────────────┤
│  optional bottom nav    │
│  or sticky footer btn   │
└─────────────────────────┘
```

- **18px horizontal padding** on scrollable content.
- **Section spacing**: `padding-top: 18–20px` for major sections.
- **Top of screen**: prefer the header strip pattern (back btn 38×38, title, right action) — see `ScreenStatus` or `ScreenCreditTerms`.

---

## Recipes by screen archetype

### A. Detail screen (e.g. Booking detail, Quote detail, Dispute detail)

**Pattern**: copy `ScreenProvider`.

1. **Hero band** — 160–200px coloured band. Use a relevant accent (category hue for plumbing, success green for completed, brand purple by default). Add the 45° stripe overlay for texture (`repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 16px)`).
2. **Floating identity card** overlapping the hero by ~64px:
   - Left: avatar / category icon tile / status badge
   - Right: title, meta line, key chip (status, urgency, etc.)
   - Primary action row at the bottom
3. **Stats strip** — 3 cells, 1px dividers, single border shell. Use for measurable facts (price, ETA, distance, rating).
4. **Body sections** — "About", "Activity", "Documents", whatever applies. Each one: SectionLabel (eyebrow), then content.
5. **Sticky bottom action bar** if there's a primary action. Otherwise CTAs live in the floating card.

**Booking detail specifically**:
- Hero band tone = status colour
- Floating card: provider avatar + name + verified + ETA chip + "Message" (whatsapp btn) + "Call" (ghost btn)
- Stats: ETA / Distance / Quote
- Sections: Job description, Address (with map placeholder), Quotes & messages, Activity timeline (status dots in a vertical thread), Documents.
- Bottom action: "Approve & continue" gradient btn / "Cancel booking" ghost danger.

### B. List screen (e.g. Provider job list, Admin queue, Saved addresses)

**Pattern**: copy `ScreenBookings` or `ScreenBrowse`.

1. Header: H1 + meta sub-line ("N items · scope")
2. Filter pill row, horizontal scroll
3. Sort row (left meta, right "Filters ⌄")
4. List of cards, 10px gap between
5. Empty state inside the list area

**Card anatomy**: top row (id mono + status chip), title, meta, optional divider, optional footer with avatar + action buttons.

### C. Form screen (e.g. Profile edit, Add address, Payment method, Submit review)

**Pattern**: copy `ScreenSignUp` or any book-flow step.

1. Header: back btn + step eyebrow + step title + stepper if multi-step
2. Optional context card (privacy / explanation, gradient-soft bg)
3. Fields stacked, **14px vertical gap** between fields (consistent with prototype)
4. Each field: `FieldLabel` (with optional `hint` for "Optional" or counter) + Input/PhoneInput/Textarea
5. 2-column row for related short fields (Unit + Complex, First + Last)
6. Custom checkbox row for consents
7. Footer: Primary btn (full-width, gradient if valid, secondary if not). Disabled state = secondary look + reduced opacity.

**Validation rules**:
- Disable primary CTA until **all required fields valid**, never show a "submit it anyway, get error" state.
- Show inline errors below the field (13/500 danger red, alert glyph 14px) once a field has been blurred OR submit attempted.
- Don't gate continue on optional fields.

### D. Status / health / metric screen

**Pattern**: copy `ScreenStatus`.

1. Overall banner — single big card, tone-tinted, dot + title + last-checked
2. Grid of sub-statuses (2×N)
3. Optional incident card (tone-tinted)
4. Components list (1 card with many rows)
5. Trend graph or sparkline at the bottom (use the 30-bar pattern for daily uptime, or a simple line chart for KPIs)
6. Footer note about data sensitivity

### E. Confirmation / success screen

**Pattern**: copy `ScreenBookSubmitted`.

1. Gradient halo behind everything (radial, 60% / 50% at 50% 30%)
2. Layered icon: outer gradient-soft tile (120px) → inner solid gradient tile (80px) → glyph (42px white)
3. H1 + body paragraph
4. Reference card (mono ref + status chip)
5. Channel card (WhatsApp confirmation) — only when WA enabled
6. Two-button footer: primary "Track / next step" + ghost "Back home"

### F. Empty state (in any screen)

```
[gradient-soft tile, 64×64, 20 radius, glyph 28px in purple]

Title — 17/700, ink
Body — 13/500, inkMute, max-width 280, balance + pretty

[primary or secondary CTA]
[optional secondary action / link]
```

Always pair an empty state with **a clear next action**, never a dead-end.

### G. Error state (page-level)

Similar to empty state but:
- Tile bg uses `rgba(229,72,77,0.10)` and glyph is danger red (alert icon)
- Title is the problem in plain English ("Couldn't load your bookings")
- Body explains likely cause + offers a retry
- Primary "Try again" + secondary "Get support" (WhatsApp deep-link if enabled)

### H. Modal / sheet (action sheets, filters, confirmation dialogs)

Mobile-first: come up from the bottom as a sheet.
- Background: `card` colour, `r.lg` top-radius (24), bottom-radius 0
- Top 36×4 rounded grab handle, 12px from top
- Title row: H2 + close X button
- Content
- Sticky footer with primary action (full-width)
- Backdrop: `rgba(10,10,15,0.4)` + `backdrop-filter: blur(6px)`

### I. Inline cards / tip cards

Use `Card` with `background: T.gradSoft` and no border/shadow for **informational** tips:

```jsx
<Card style={{ background: gradSoft, boxShadow: 'none' }}>
  <ShieldIcon color={purple} />
  <p><b>Heading.</b> Body.</p>
</Card>
```

Use `Card` with **coloured tint + 1px coloured border** for **status notices** (incident, warning):

```jsx
<Card style={{
  background: 'rgba(230,153,0,0.08)',
  boxShadow: 'inset 0 0 0 1px rgba(230,153,0,0.25)',
}}>
```

---

## Specific screens you're likely to encounter

### Quote / offer (customer accepting a provider's quote)

- Detail-screen pattern (Recipe A)
- Hero tone = brand purple gradient
- Floating card: provider avatar + name + rating pill + verified
- Stats strip: Quote total / Call-out / ETA
- Body sections:
  - **What's included** — list of line items, each row: tick glyph + label + price (right-aligned)
  - **Provider terms** — short paragraph
  - **Schedule** — proposed date/time card, with "Suggest another" link
- Sticky bottom: Accept quote (gradient) + Decline (ghost danger). On accept → /book/submitted-style confirmation, then thread continues in /bookings/:id.

### Rating & review (after a completed job)

- Centred content
- Provider avatar (large, 80px) + name
- 5 star buttons, 44×44 tap targets, gold when selected
- Tag chip selector: "On time", "Friendly", "Tidy", "Great quote", "Communication", etc. (multi-select)
- Textarea for written review (optional, 500 char limit)
- Privacy note: "Reviews are public, but your full name is shortened to first name + last initial."
- Primary "Submit review →"

### Provider profile editor

- Form pattern (Recipe C)
- Top: avatar with edit button overlay
- Sections (each with eyebrow):
  - About — first name, last name, bio textarea
  - Services — multi-select chip grid (same categories as customer)
  - Service areas — 2-col list of selected suburbs with delete X, plus "+ Add area" button
  - Pricing — Call-out fee (R input), Hourly (R input), After-hours surcharge (% input)
  - Verification — list of uploaded docs with status chips (Verified/Pending/Rejected)
- Sticky bottom: "Save changes" gradient

### Provider job acceptance detail (from a lead)

- Detail-screen pattern (Recipe A)
- Hero tone = urgency colour
- Floating card: category icon tile + job title + urgency chip
- **Locked address strip** — yellow-tinted card BEFORE acceptance: lock glyph + "Suburb: Allen's Nek · Full address unlocks on acceptance"
- Stats: Lead cost (credits) / Customer area / Posted (relative time)
- Body sections:
  - Job description
  - Photos (gallery row)
  - Customer (avatar + first name + initial only, rating count if returning)
- Sticky bottom: Decline (ghost) + **"Accept · 1 credit"** (gradient)
- After accept: same screen re-renders with the address strip revealed (with map), phone number visible, and bottom CTAs become "Message on WhatsApp" + "Call".

### Top-up flow (provider credits)

- Form pattern (Recipe C) with a small product-selector
- Header: "Top up credits"
- Big preview card showing current balance (mirror the credits hero from `/provider`)
- **Amount selector** — 3-tile grid: 10 credits / R500, 25 credits / R1,250, 50 credits / R2,500 (popular badge). Or "Custom amount" tile that reveals an input.
- Payment method selector — radio list of saved methods or "Add new" row.
- Sticky bottom: "Pay R{total} →"
- After Payfast redirect & return: success screen pattern.

### Dispute detail (admin)

- Detail-screen pattern (Recipe A)
- Hero tone = danger red
- Floating card: title + ref + opened-by avatar
- Stats: Days open / Job value / SLA remaining
- Sections:
  - Timeline (vertical thread of dots + events)
  - Customer view (their statement)
  - Provider view (their statement)
  - Evidence (uploaded files)
  - Internal notes (admin-only)
- Sticky bottom: Resolve (gradient) + Escalate (ghost) + Refund (danger ghost). Each opens a sheet with details.

### Address book / saved addresses

- List pattern (Recipe B)
- Each card: pin icon tile + Label ("Home", "Work") + 2-line address + chevron
- "Default" chip on the default address (brand tone)
- Bottom: "+ Add address" secondary

### Notification settings (sub-page)

- Form pattern (Recipe C) with toggles
- Group sections:
  - **Channels**: Push / SMS / **WhatsApp (recommended)** / Email — each row is a name + body + toggle
  - **Topics**: Quote received / Provider en route / Provider arrived / Job completed / Payment / Rating reminder / Marketing
- No sticky footer needed — toggles save immediately, show a toast on save.

### 404 / generic error

- Centred content like Link Expired
- 88×88 gradient-soft tile with 56×56 white inner tile + "?" or X glyph
- H1 "We can't find that page" / "Something went wrong"
- Body with 1 sentence of context
- Primary "Back to home" + ghost "Report this"

### Onboarding tour (first launch)

- Full-bleed coloured background using brand gradient at very low opacity
- Centred content: large illustrative placeholder (use striped placeholder rectangles for now — ask for real imagery)
- H1 + body paragraph
- 3 dots indicator at the bottom (current = purple, others = border)
- Sticky bottom: "Continue" / "Get started"
- Top right: "Skip" ghost link

---

## Don'ts (common mistakes when extending)

1. **Don't use the gradient as a screen background.** Soft neutrals only. Gradient is reserved for moments.
2. **Don't introduce new accent colours.** The category hues are the only "branded" hues besides the gradient. If you need a new accent, use brand purple.
3. **Don't write emojis into UI strings.** This brand uses line icons, not emojis. The 🇿🇦 flag in the phone country code is the only exception.
4. **Don't stack cards with raised shadows.** Use flat (border-only) cards inside a parent. Raised cards are for hero/floating moments.
5. **Don't use drop shadows on text or icons.** Subtle box-shadows only, on cards and buttons.
6. **Don't show full address, full phone, or full name** anywhere a provider can see it before they've accepted the job.
7. **Don't render WhatsApp UI when the WA integration is disabled** — fall back to SMS/email + standard "send code" copy.
8. **Don't let a CTA be ambiguous about cost.** If accepting a lead uses credits, the button or the row directly above must say so.
9. **Don't put more than one primary gradient button on a screen.** One is the primary, others must be secondary.
10. **Don't use rounded corners > 28px** on cards or buttons — looks toy-ish at mobile scale. The hero icon tiles at 36 are the exception, intentionally chunky.

---

## Checklist for any new screen

Before opening a PR:

- [ ] Header strip uses standard back btn + title pattern (or status-bar safe area on auth screens)
- [ ] All copy uses South African English & avoids marketing fluff
- [ ] Primary action is a single gradient button (or none on a passive screen)
- [ ] No emoji except 🇿🇦 in the country selector
- [ ] Icons are line, 1.6 stroke, 20×20
- [ ] All text on a coloured background passes WCAG AA contrast
- [ ] Empty state exists for the screen
- [ ] Error state exists for any fetch
- [ ] Loading state uses skeleton bars in the same shape as the loaded content (not spinners)
- [ ] Responsive: works at 360 / 390 / 414 widths
- [ ] Dark mode: every colour you used has a dark-mode counterpart in `tokens.jsx`
- [ ] No animation > 300ms; respect `prefers-reduced-motion`
- [ ] WhatsApp UI hidden when the WA env flag is off
- [ ] Privacy callout present anywhere customer details could be exposed

---

## When to ask for a mock

Come back for a specific design pass when:
- The screen has **a workflow not in this prototype** (e.g. live job tracking with map + driver position)
- It involves **media-rich content** (galleries, video, real charts)
- It's a **brand-level moment** (homepage hero variant, marketing splash, app store screenshots)
- The screen has **>4 distinct states** to design (success / error / loading / empty / partial / etc.)
- A stakeholder explicitly asks for a mock review

Otherwise, follow the recipes above and ship.
