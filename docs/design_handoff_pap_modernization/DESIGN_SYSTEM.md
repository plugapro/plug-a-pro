# Design System

Single source of truth. **All token values are in `prototype/tokens.jsx`** — copy them directly. This document is the readable summary.

---

## 1. Type

| Role | Family | Weights |
|---|---|---|
| UI | **Plus Jakarta Sans** | 400 / 500 / 600 / 700 / 800 |
| Mono (codes, refs, OTP timer) | **DM Mono** | 400 / 500 |

Load via Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Type scale

| Use | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|
| Display title (Home, screen H1) | 28–30 | 700 | -0.6 to -0.7 | 1.1 |
| Section H2 (Card title) | 17–19 | 700 | -0.2 to -0.3 | 1.2 |
| Body | 14–14.5 | 500 | 0 | 1.5 |
| Small body | 13–13.5 | 500 | 0 | 1.5 |
| Caption / meta | 12–12.5 | 500 | 0 | 1.4 |
| Eyebrow (uppercase) | 11 | 700 | 0.8–1.0 | 1.4 |
| Mono ref (PAP-4821) | 11–13 | 500–600 | 0.4 | 1 |

Use `text-wrap: balance` on H1, `text-wrap: pretty` on body paragraphs.

---

## 2. Colour

### Neutrals (light mode)

```
page          #F6F6F8
card          #FFFFFF
card-alt      #F1F1F4
border        #EBEBEF
border-strong #D9D9DE
ink           #0A0A0F      // primary text
ink-mute      #6B6F76      // secondary text
ink-soft      #9CA0A8      // tertiary text
```

### Neutrals (dark mode)

```
page          #0B0B10
card          #15161C
card-alt      #1B1C24
border        #26272F
border-strong #33343D
ink           #F4F4F6
ink-mute      #A0A0AB
ink-soft      #71727B
```

### Brand gradient (logo-derived, use sparingly)

```
start  #FF1F8E   (pink)
mid    #8B3FE8   (purple)
end    #2A78F0   (blue)
```

Linear gradient: `linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)`

Soft tint (for halos, brand chip backgrounds):
`linear-gradient(135deg, #FF1F8E18 0%, #8B3FE814 50%, #2A78F018 100%)`

**Single-colour accent** (focus outlines, links, "see all" actions): `#8B3FE8` (purple, the middle stop).

### Channel & status

```
WhatsApp        #25D366    // bg of WA buttons, glyph color
WhatsApp deep   #1FAD52    // WA text on light tint backgrounds
success         #0F9D58
warning         #E69900
danger          #E5484D
```

### Category accent hues (used for category icon tiles only)

```
Plumbing    #2A78F0
Electrical  #FFC22B
Handyman    #8B3FE8
Carpentry   #C8854D
Painting    #FF1F8E
Cleaning    #0FA28A
Appliances  #5B5B66
Gas/Geyser  #E5484D
```

Render as `background: <hue>15` (10% alpha tint) with `color: <hue>` for the glyph.

### Gradient usage rules

- **Yes**: primary CTAs, focused input outlines, brand eyebrows, the wordmark, "verified" checkmark badges, decorative top-of-screen haloes (very low opacity).
- **No**: backgrounds of full screens, body text, cards, secondary buttons, divider lines, success/error states.

---

## 3. Spacing

Base unit **4px**. Component padding & gap follow density.

| Density | section gap | card pad | row height |
|---|---|---|---|
| compact | 16 | 16 | 44 |
| **cozy (default)** | 24 | 20 | 52 |
| comfy | 32 | 24 | 60 |

Horizontal screen padding: **18px** (cozy). Increase to 22 for hero/auth shells.

Vertical between major sections: **18–22px** between section labels.

---

## 4. Radii

```
xs    6
sm    10
md    16   ← buttons, inputs, chips-rectangular
lg    24   ← cards
xl    28   ← featured cards
pill  9999
```

`md` is configurable (tweak in prototype slider, 6–24). Bake the chosen value as a token; don't make user-configurable in production.

---

## 5. Shadows / elevation

- **Card flat**: `inset 0 0 0 1px <border>` — that's it. Border replaces shadow.
- **Card raised** (e.g. provider profile float): `0 1px 0 <border>, 0 10px 30px rgba(15,15,30,0.06)`
- **Primary button glow**: `0 1px 0 rgba(255,255,255,.25) inset, 0 8px 24px <purple>33, 0 2px 6px <purple>22`
- **WhatsApp button glow**: `0 1px 0 rgba(255,255,255,.25) inset, 0 6px 18px #25D36655`
- **Bottom-nav backdrop**: `backdrop-filter: blur(20px) saturate(180%)` + `rgba(255,255,255,0.85)` + `inset 0 1px 0 <border>` (no large shadow)

---

## 6. Iconography

- Stroke icons, **1.6px stroke**, 20×20 viewBox by default.
- Round line caps + joins.
- Use `currentColor` so they pick up parent colour.
- Glyphs used: see `prototype/icons.jsx`. If the codebase uses **Lucide**, the closest matches are:

| Custom | Lucide |
|---|---|
| IcHome | `home` |
| IcSearch | `search` |
| IcCal | `calendar` |
| IcUser | `user` |
| IcArrow / IcArrowL | `arrow-right` / `arrow-left` |
| IcCheck | `check` |
| IcX | `x` |
| IcPin | `map-pin` |
| IcPhone | `phone` |
| IcLock | `lock` |
| IcMail | `mail` |
| IcShield | `shield` |
| IcStar | `star` (filled) |
| IcChev / IcChevD | `chevron-right` / `chevron-down` |
| IcPlus | `plus` |
| IcBell | `bell` |
| IcSpark | `sparkles` |
| IcInfo | `info` |
| IcAlert | `alert-circle` |
| IcLogout | `log-out` |
| IcSettings | `settings` |
| IcCard | `credit-card` |
| IcTime | `clock` |
| IcZap | `zap` |
| IcWrench | `wrench` |
| IcBolt | `zap` (alt) |
| IcDroplet | `droplet` |
| IcSaw | `hammer` (closest) |
| IcBrush | `paintbrush` |
| IcSpray | `spray-can` |
| IcOven | `microwave` (closest) |
| IcFlame | `flame` |
| IcWhats | `message-circle` — but use the actual WhatsApp logo SVG for any WhatsApp surface (brand recognition matters) |
| IcMap | `map` |
| IcEye / IcEyeOff | `eye` / `eye-off` |
| IcRefresh | `refresh-cw` |
| IcGrid | `layout-grid` |

---

## 7. Components

Each maps to a primitive in `prototype/ui.jsx`. Read that file for the full spec — this is a summary.

### Button

| Variant | Background | Text |
|---|---|---|
| primary | brand gradient | white |
| secondary | `card` + `1px border` | `ink` |
| ghost | transparent | `ink` |
| dark | `ink` | `card` |
| whatsapp | `#25D366` | white |
| danger | `#E5484D` | white |
| tinted | `rgba(15,15,20,0.04)` | `ink` |

Heights: **sm 40, md 48 (default), lg 54**. Border radius `md`. Always full-width on mobile by default. Use `fullWidth={false}` for inline button rows. Disabled: opacity 0.45.

### Input

- Height **52**, radius `md`, padding `0 14px`, gap `10` between leftIcon / input / rightIcon.
- Border = `inset 0 0 0 1px <border>`; focus = `inset 0 0 0 1px <purple>` (1.5 if you want chunkier).
- Left icon coloured `<inkMute>` when blurred, `<purple>` when focused.
- Placeholder is `<inkSoft>`. Body text is `<ink>`.

### PhoneInput

Split: country segment (flag + +27 + chevron) on left with `inset -1px 0 0 <border>`, number input on right. Country segment background `#F4F4F7` (light) or `rgba(255,255,255,.04)` (dark). Single rounded shell around both.

### OTPInput

6 individual inputs, each `flex:1 height:56`, mono font 24/600, centered. Empty = 1px border; filled = 1.5px purple border. Auto-advance + backspace to previous.

### Card

Two variants:
- **flat** (default): white bg, `inset 0 0 0 1px border`.
- **raised**: same bg, `0 1px 0 border, 0 10px 30px rgba(15,15,30,0.06)`. Use for hero / floating profile cards.

Padding = `<density.cardPad>` (20 cozy). Radius `lg` (24).

### Chip

Pill, height 32, padding `0 12px`, radius `pill`, font 13/600. Tones:
- `neutral` (inactive grey OR active black)
- `success / warn / danger` — coloured 10% bg + dark text
- `brand` — gradient soft-tint bg, purple text
- `whatsapp` — `rgba(37,211,102,0.12)` bg, `#1FAD52` text

### Stepper

Horizontal segments equal-width, height 4, radius 999. Future = `border`, done & current = `purple` (current at 0.55 alpha). Used in book flow header.

### Bottom Nav (tabs)

Position absolute bottom of phone shell. **Backdrop blur**, not solid. 4 items by default (Home, Browse, Bookings, Account). Active item: 44×28 rounded pill with gradient-soft background behind icon, purple icon + label.

### Status dot

`width=8, height=8, border-radius:50%`, coloured per tone, plus a **`box-shadow: 0 0 0 4px <tone>22`** to give a soft halo.

### Avatar

- With photo: 100% rounded square crop, `cardAlt` bg fallback.
- Without photo: 100% rounded gradient circle with **2 initials** in white 700, font size = `size * 0.36`. For provider avatars use the provider's tone hue as the gradient start instead of the brand pink: `linear-gradient(135deg, <tone> 0%, <purple> 100%)`.

### Toast

Position absolute, top 60, dark ink bg, card text, radius `md`, padding 12/14, gap 10. Check glyph + message + dismiss X. `box-shadow: 0 10px 30px rgba(0,0,0,0.2)`.

---

## 8. Motion

Subtle and short. We are not flashy.

- Screen enter: 250ms `ease-out`, translateY(6px) → 0 + opacity 0 → 1
- Hover-able interactive elements (cards, buttons): no transform, only `box-shadow .15s` / `background .15s`
- Focus ring transitions: 150ms
- Stepper progress: 250ms ease-out
- Bottom-nav pill background: 150ms

Use `prefers-reduced-motion: reduce` to disable enter animation.

---

## 9. Tone & copy rules

- **Trustworthy, effortless, helpful.** Plain language, no marketing fluff.
- Don't say "users" — say "you / your / them".
- South African English (booking, suburb, geyser, R350).
- Currency: `R350` (no decimals for round figures); `R2,450.50` with separator + decimals only when relevant.
- Time: 24-hour for status / system, 12h or 24h for booking based on locale.
- Phone: `+27 82 555 0142` displayed with `+27` prefix when shown back; **input** is collected as the local 9–10 digits with the +27 chip beside it.
- Reference IDs: `PAP-####` in DM Mono, soft colour.

---

## 10. Privacy callouts

These appear three places:
1. **Book flow Step 2 (address)** — full callout card with shield icon.
2. **Book flow Step 4 (review)** — small reminder under address block.
3. **Home footer** — single line.

Wording template:

> Your details stay private. Providers only see your **suburb** and province until they accept. Full address and phone number unlock after acceptance.

Reuse exact wording across the app for cohesion.
