# Kickoff prompt for Claude Code

Copy everything inside the fence into Claude Code's first message after you've opened the Plug A Pro PWA repo and dropped this `design_handoff_pap_modernization/` folder somewhere inside it (or alongside it).

---

```
You are picking up a redesign of the Plug A Pro PWA. I've placed a design handoff
package in ./design_handoff_pap_modernization/ — please use it as the source of truth.

PLEASE DO NOT START CODING YET. Work through these steps with me first.

Step 1 — Read the brief, in this order:
  1. design_handoff_pap_modernization/README.md
  2. design_handoff_pap_modernization/BROWSE_FIRST_UPDATE.md   ← critical, defines the new flow
  3. design_handoff_pap_modernization/DESIGN_SYSTEM.md
  4. design_handoff_pap_modernization/SCREENS.md
  5. design_handoff_pap_modernization/APPLYING_TO_OTHER_SCREENS.md
  6. design_handoff_pap_modernization/IMPLEMENTATION_PLAN.md

The files in design_handoff_pap_modernization/prototype/ are an HTML/React design
reference, NOT production code to copy. The plain HTML prototype runs inline React
via Babel for portability. Your job is to recreate these designs in THIS codebase
using its existing framework, component library, state management, and routing
conventions. If a primitive doesn't exist in our component lib yet, build it once
using the tokens from DESIGN_SYSTEM.md and reuse it.

Step 2 — Audit the existing codebase. Tell me:
  - The framework (Next.js / Vite + React / etc.) and version
  - The styling solution (Tailwind / CSS Modules / styled-components / …)
  - The state management and data-fetching libs
  - The routing layout
  - Which design primitives (Button, Input, Card, Chip, Modal, BottomNav…) already
    exist that we can lean on vs. need to build
  - The current Home / Browse / Booking code paths and where they live

Step 3 — Answer the four open questions in README.md ("Open questions before
building"). Propose defaults; I'll override where needed.

Step 4 — Confirm the implementation order. The plan in IMPLEMENTATION_PLAN.md is:
  Phase 0  Foundations (tokens, fonts, primitives)
  Phase 1  Customer auth flow
  Phase 2  Area system + Customer core   ← read BROWSE_FIRST_UPDATE.md before this
  Phase 3  Booking flows (quick + urgent)
  Phase 4  Provider flows
  Phase 5  Internal & utility screens
  Phase 6  Polish

We will ship one phase per PR. Do NOT batch phases together. For each PR, before you
start writing code, show me:
  - The file tree you intend to touch
  - The new components you'll create with their props
  - Any API contract assumptions
  - Open questions

I'll approve, then you implement.

Hard constraints across everything:
  - Fonts: Plus Jakarta Sans (UI) + DM Mono (refs, codes). Load both.
  - Brand wordmark renders as plain text "Plug A Pro" with normal spaces. No gradient,
    no dot separators, no per-letter styling. Single span.
  - Brand gradient (linear-gradient(135deg, #FF1F8E, #8B3FE8, #2A78F0)) is for primary
    CTAs, focused field outlines, brand badges, decorative haloes ONLY. Never as a
    full-screen background.
  - Light + dark themes both supported. Use prefers-color-scheme by default.
  - Suburb-only privacy: full address only shared with a provider AFTER they accept.
    This must be reflected in copy, UI, and API contracts.
  - WhatsApp prominence is intentional everywhere the channel is in play. If the WA
    integration is off via env flag, hide those elements entirely.
  - The "Available near {suburb}" provider strip on Home and the area chip at the top
    of Home + Browse are non-negotiable. They are the entire point of this redesign.
  - The booking flow has TWO entry points: quick (from a provider profile, 2 steps)
    and urgent (from "Need help right now?" or empty-state CTAs, 4 steps). Don't
    collapse them into one.

Start with Step 1. When you've finished reading, summarise back to me — in your own
words — what changed in this redesign versus the previous direction, and why. That's
how I'll know you've actually read it.
```

---

## Notes for you (the human)

- **Open the prototype before sharing this** — `prototype/Plug A Pro PWA.html` in a
  browser, click around all the screens via the left sidebar, so you have a mental
  model when Claude Code asks clarifying questions.
- **Answer the four open questions in README.md up front.** They are: light/dark
  default, WhatsApp env flag, icon library preference, and density. Claude Code will
  ask, but you'll move faster if you've already decided.
- **One phase per PR.** Don't let Claude Code combine Phase 2 and Phase 3 — the area
  system is a big surface area on its own and you'll want to review it cleanly.
- **If anything is wrong in the spec**, tell Claude Code to push back to you and ask
  me, rather than guess. The spec is dense and probably has a few rough edges.
- **If you're using a non-React stack** (SwiftUI, Flutter, Vue, etc.), tell Claude
  Code that in Step 2. The handoff is framework-agnostic by design — only tokens,
  layouts, copy, and behaviour are prescribed.
