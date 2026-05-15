# Screens

One section per screen in the prototype. For each: **route, source file, copy, layout, interactions, edge states.** All measurements assume cozy density.

> Read these alongside the corresponding screen in `prototype/Plug A Pro PWA.html` — open it and use the left sidebar to navigate.

---

## Customer

### 1. Home — `/`

**Source**: `screens-customer.jsx :: ScreenHome`

**Purpose**: First-touch discovery. Customer searches for help, browses categories, or starts a request.

**Layout (top → bottom)**:
1. **Status-bar safe area** (54px)
2. **Header strip** — `[logo 32px][wordmark "PLUG · A · PRO"][spacer][notification bell 38×38 with pink unread dot]`
3. **Trust pill** (eyebrow) — gradient-soft bg, purple text: "Reviewed providers · Pay after the job"
4. **Hero H1** — 30/700/-0.7, `text-wrap: balance`
   - Signed-out: "Find trusted help, near you."
   - Signed-in: "Hi {firstName} — what needs fixing?"
5. **Hero subhead** — body, max-width 320, `inkMute`.
6. **Search bar** — 56px high, raised card style, 18 radius. Trailing **gradient "Request" button** (44px, 14 radius, zap icon).
7. **Location chip** — pill, pin icon (purple), suburb name + chevron-down.
8. **Browse by category** — 4×2 grid, 8 categories. Each tile: 36×36 hued icon tile on top, 11.5/600 label below. Card bg, 16 radius, 1px border.
9. **Top rated near you** — 2 ProviderCards stacked.
10. **How it works** — single card with 4 rows, each: gradient-soft icon tile + bold title + caption. Bordered between rows.
11. **For service providers** CTA — dark ink card with a brand-gradient blur halo. Heading + body + "Join as provider" (white solid btn) + "Apply" (WhatsApp green btn).
12. **Footer** — small `inkSoft`, 11.5px, two-line text with credit-terms + status links.

**Interactions**:
- Bell → `/notifications`
- Request btn → `/book`
- Category tile → `/browse?cat=<label>`
- Provider card → `/providers/{id}`
- "Join as provider" → `/provider/sign-in`
- WhatsApp Apply → opens `wa.me/...?text=Register`

**Empty state**: signed-out user — copy switches, no bookings section. (Sign-in is a separate screen — don't gate the home page).

---

### 2. Find a provider — `/browse`

**Source**: `screens-customer.jsx :: ScreenBrowse`

**Layout**:
1. H1 "Find a provider" + small meta line: `{N} reviewed providers · {category} · {suburb}` + a Map pill button (right-aligned)
2. **Search** input (full-width)
3. **Category pills** — horizontal scroll, ends bleed off-screen. "All" first, then 8 categories. Active = `ink` bg `card` text.
4. **Sort row** — left: `Sorted by <b>Rating</b>`, right: `Filters ⌄` button (purple)
5. **Provider list** — ProviderCards stacked.

**Provider card** (full anatomy):
- Top row: 52×52 gradient avatar, name (700/15) + verified badge, rating pill `★ 4.9 · 127 jobs`, pin + area + years
- Service chips (brand tone)
- Divider line
- Bottom row: "Call-out from" + R### + "rate negotiable", **availability chip** right-aligned (success "Available now" / warn "Busy today")

**Empty state**: card with centred text "No providers in this category yet" + "Try another category or request a service".

**Filters**: Drawer / sheet with checkboxes for: availability (now / this week / any), rating (any / 4★+ / 4.5★+), price (any / R<300 / R300-500 / R500+), distance (5/10/25/50 km), verified only. Apply / Reset.

---

### 3. Provider profile — `/providers/:id`

**Source**: `screens-customer.jsx :: ScreenProvider`

**Layout**:
1. **Hero band** — 200px, full-width gradient using provider's tone + brand purple. Striped overlay at 45° (1px lines, 6% alpha) for texture. Back btn (top-left, frosted glass), more btn (top-right).
2. **Profile card** — overlaps hero by 64px. Inside: 66×66 gradient avatar, name + verified, rating pill, location row. CTA row below: **gradient "Request service"** (flex 1) + WhatsApp icon button (48×48 square, brand green).
3. **Trust strip** — 3-column row: `{years} yrs / Experience`, `{jobs} / Jobs done`, `98% / On-time`. 1px dividers between cells, single 16-radius shell.
4. **About** — body paragraph.
5. **Services** — wrap of brand chips.
6. **Pricing & terms** — card with 4 rows: Call-out fee, Hourly rate, After-hours, Quote turnaround.
7. **Recent reviews** — 2 cards visible, "See all {N}" link. Each card: avatar + name + relative time, 5-star row, body.

**Interactions**:
- Request service → `/book?providerId={id}` (pre-fills provider context)
- WhatsApp → opens chat
- Star rating tap → modal with full reviews

---

### 4. Book service flow — `/book`

**Source**: `screens-book.jsx :: ScreenBook` (+ `BookStepCategory`, `BookStepAddress`, `BookStepDetails`, `BookStepReview`)

**Shared shell**:
- Header: back btn, eyebrow `"Request a service · Step {n} of 4"`, title (current step name), Stepper (4 segments)
- Body: step content
- Footer button: "Continue →" on steps 1–3, "Submit request ✓" on step 4

**Step 1: Category** — Privacy callout card at top (gradient-soft bg). Section label "What do you need help with?". 2-column grid of 8 categories. Selected tile gets 1.5px purple border + small purple glow.

**Step 2: Address** — Privacy card with lock icon ("Address privacy" + explanation). "Use my current location" secondary button. "or enter manually" divider with horizontal rules. Stacked fields: Province (with chevron), Suburb, Street address. Two-column row: Unit (optional), Complex (optional). Validation: continue disabled if suburb + street are empty.

**Step 3: Details** — Job title (Input), Description (textarea 280-char limit, char counter in field label `hint`), **Urgency** 3-tile selector (Emergency red / Soon orange / Flexible green), Photo upload row (3 square tiles, tap to fill — placeholder stripe pattern when empty, brand gradient + stripes when filled).

**Step 4: Review** — Four cards: Service (cat icon + label + urgency), Address (formatted + lock reminder), Details (title + description), Contact (avatar + name + phone, WhatsApp chip).

**Submission**: tap "Submit request" → optimistic navigation to `/book/submitted`. Show error toast if API fails.

---

### 5. Request sent — `/book/submitted`

**Source**: `screens-book.jsx :: ScreenBookSubmitted`

Centred success state. Layered icon: 120×120 gradient-soft rounded square containing 80×80 gradient solid containing a 42px check glyph. Title "Request received". Body explaining matching. Reference card showing `PAP-####` ref + "Matching" status chip. Optional WhatsApp confirmation card (only if WA enabled). Primary CTA "Track this request" → `/bookings`. Ghost btn "Back to home".

---

### 6. My bookings — `/bookings`

**Source**: `screens-customer.jsx :: ScreenBookings`

- H1 "Your bookings" + subline "Active and recent requests"
- Filter pills row: Active / Pending / Completed / Cancelled (horizontal scroll). Active = `ink` bg.
- Booking cards. Each card:
  - Top: `PAP-####` mono ref (left), status chip with status dot (right)
  - Title (700/16), `{category} · {when}`
  - Divider
  - Bottom row: avatar + provider name + WhatsApp btn (if applicable) + dark "View" button

Bottom: secondary "Request another service" button with plus icon → `/book`.

**Empty state**: card centred — "No active bookings", "When you request a service it'll appear here", "Request service →" link.

---

### 7. Account — `/account`

**Source**: `screens-customer.jsx :: ScreenAccount`

**Signed-out**: empty-state card — gradient-soft icon tile (user glyph) + "Sign in to track jobs" + "Sign in" primary btn + "Create an account" link. Below that: secondary "Other access" card with Provider sign-in + Internal team rows.

**Signed-in**: top profile card (avatar + name + phone + role chip + settings cog). Then 3 grouped sections:
- **Activity**: My bookings, Payments, Reviews you've left
- **Settings**: Notifications, Saved addresses, Privacy & security
- **Help**: System status, Credit & billing terms, Sign out (in danger color, no chevron)

Each row: 36×36 tinted icon tile + title + subtitle + chevron-right (or nothing for terminal actions).

---

### 8. Notifications — `/notifications`

**Source**: `screens-misc.jsx :: ScreenNotifications`

Back btn + "Notifications" title + "Mark all read" pill (top-right).

List of cards. Each card:
- Coloured icon tile (channel-coloured: WhatsApp green for WA, purple for matches, gold for ratings, success for payment)
- Title (700/14) + body (12.5, mute) + relative time (11, soft)
- **Unread dot** (8×8 pink) top-right corner of card

Group by day in production: Today / Yesterday / This week / Earlier — sticky group label.

---

## Auth & access

### 9. Customer sign in — `/auth/sign-in`

**Source**: `screens-auth.jsx :: ScreenSignIn`

**AuthShell**:
- 54px top safe area
- Top bar: back btn (only when not the root) — logo + wordmark centre — spacer right
- Gradient halo bleeds from top (radial gradient, very low opacity)
- Centered content: eyebrow (purple uppercase 11/700) → H1 (28/700, centered) → subhead (14.5/500, centered, mute, max-width naturally) → form

**Body**:
- Field label "Mobile number"
- PhoneInput (autofocused on empty, pre-filled in prototype for demo only)
- **WhatsApp info card** (only when WA enabled): light green tint, 1px green border, WA-tile icon, "We'll send a 6-digit code via WhatsApp. SMS fallback if needed."
- Primary btn "Send code →" (disabled until valid: ≥9 digits)
- "New here? Create an account" link
- "OR" divider
- Secondary btn "I'm a service provider" (wrench icon, purple tint)
- Ghost btn "Internal team sign in" (shield icon)

**Validation**: `phone.replace(/\D/g,'').length >= 9` to enable.

---

### 10. Verify OTP — `/auth/verify`

**Source**: `screens-auth.jsx :: ScreenOTP`

- AuthShell with back btn → returns to the originating sign-in screen (customer or provider, based on `role` query/param)
- Eyebrow "Verify"
- H1 "Enter the 6-digit code"
- Subhead: "Sent to **+27 82 555 0142**[ via WhatsApp]"
- OTPInput, autofocus first
- **Error**: if code submitted is wrong → red alert glyph + "That code didn't match. Try again." (red text, centered)
- **Resend timer**: "Resend code in **0:28**" (mono numeral). After 0, becomes a tappable "Resend code" link (purple). Reset to 30s on resend.
- Primary btn "Verify & continue" (disabled until 6 chars)
- WhatsApp deep-link button (text only, green): "Open WhatsApp to find the code"

**On success**: navigate to `/` (customer) or `/provider` (provider) depending on `role`. Set auth cookie / token.

---

### 11. Sign up — `/auth/sign-up`

**Source**: `screens-auth.jsx :: ScreenSignUp`

- AuthShell with back btn → `/auth/sign-in`
- Eyebrow "New here"
- H1 "Create your account"
- Subhead "Takes about 30 seconds. We'll text you when a provider accepts your request."

**Fields**:
- First name + Last name (2-col grid)
- Mobile number (PhoneInput)
- Email (Input with mail icon, marked optional)
- **Custom checkbox row** — 20×20 box, when checked: gradient bg + white check. Label: "I agree to the **Terms** and **Privacy Policy**. I understand my phone number is only shared with a provider after I accept their quote." (purple bold for links)

Primary btn "Create account →" — disabled until first + last + valid phone + agreed. On submit → `/auth/verify?role=customer&phone=...`.

---

### 12. Link expired — `/auth/expired`

**Source**: `screens-auth.jsx :: ScreenLinkExpired`

Plain AuthShell with no back. Centered content:
- 88×88 gradient-soft rounded tile containing a 56×56 white card containing a 28px clock glyph (warning yellow tint)
- H1 "This link has expired" (24/700)
- Body explaining why + what to do
- Primary "Start a new request →" → `/book`
- Secondary "Sign in to my account" → `/auth/sign-in`
- Optional ghost-text WhatsApp btn "Reopen WhatsApp chat"

---

### 13. Provider sign in — `/provider/sign-in`

**Source**: `screens-auth.jsx :: ScreenProviderSignIn`

- AuthShell back → `/auth/sign-in`
- Eyebrow "Provider portal"
- H1 "Sign in to accept jobs"
- Subhead "Use the mobile number linked to your approved Plug A Pro provider profile."

**Body**:
- PhoneInput + send-code button (same pattern as customer)
- **"Not approved yet?" card** — light green tint, brand-green-tinted WhatsApp logo, big "Open WhatsApp · Send 'Register'" button
- Footer link "Looking for customer sign in? Tap here →"

---

### 14. Admin sign in — `/admin/sign-in`

**Source**: `screens-auth.jsx :: ScreenAdminSignIn`

- AuthShell back → `/auth/sign-in`
- Eyebrow "Internal · Admin portal"
- H1 "Team access"
- Subhead "For Plug A Pro staff only. SSO and 2FA are enforced."

**Fields**:
- Work email (Input with mail icon, type=email)
- Password (Input with lock icon, type=password — eye/eye-off toggle right)
- Field label hint "Forgot?" (purple)
- Primary "Sign in →"
- Below: tinted info row with shield glyph: "All actions are logged and audited. Unauthorized access is prohibited."

In production: redirect to SSO provider on submit; **do not** keep password in client state any longer than necessary.

---

## Internal

### 15. Provider dashboard — `/provider`

**Source**: `screens-misc.jsx :: ScreenProviderHome`

**Top bar**: logo + "Provider portal" eyebrow + "Hi {first}" title + logout button (right).

**Credits hero card** — dark ink card, brand-gradient blur halo top-right.
- Eyebrow "Credits balance" + sparkles glyph
- Huge number `48` + "credits · R2,400" caption
- Two buttons: white "+ Top up" (flex 1), translucent "Terms" (link to `/credit-terms`)

**Stats row** — 3 cards: Active jobs / This month / Rating ★.

**Availability toggle** — single card with green status dot + "You're available now" + body + an iOS-style toggle switch (currently on).

**New leads** — section of lead cards. Each card:
- Title (700/15), category + suburb + relative time meta row
- Urgency chip (Emergency red / <48 hrs orange / Flexible green)
- Divider
- "Lead unlock: **{N} credits**" (left, with sparkles icon, purple) + Decline button (cardAlt, ink) + **Accept** button (gradient, white, check icon)

**In progress** — single card preview of current active job.

---

### 16. Admin operations — `/admin`

**Source**: `screens-misc.jsx :: ScreenAdminHome`

**Top bar**: logo + "Admin · internal" eyebrow (in warning yellow) + "Operations" title + logout.

**KPI grid** — 4 cards, 2×2: Open requests / Active providers / Disputes / SLA met. Each card: small label, big number (700/24), coloured sub-stat ("+12 today", "1 SLA risk", etc).

**Queue · Needs attention** — list of rows. Each row: status dot (warn/danger/success) + title + `PAP-#### · {age}` meta + chevron right. Tap → row detail.

**Systems** — small list of components and status, plus "Full status →" link to `/status`.

---

### 17. Service status — `/status`

**Source**: `screens-misc.jsx :: ScreenStatus`

**Header**: back btn + "Plug A Pro · Service status" eyebrow + "System health" title + auto-refresh chip showing countdown (`28s`, mono).

**Overall banner** — green-tinted card with green status dot + "All systems operational" (700/18) + last-checked timestamp.

**Journey health grid** — 4 cards: Customer / Provider / Payments / WhatsApp. Each: small icon tile + label + dot + "Operational" / "Degraded".

**Incident notice** (optional) — yellow-tinted card with alert glyph, title, body, mono timestamp.

**Components list** — single card with rows: API / Database / Read replicas / Job dispatcher / WhatsApp Cloud API / Payfast / SMS fallback / Email. Each shows status dot + value in the appropriate colour.

**Uptime sparkline** — 30 bars at the bottom showing 30-day uptime (green normal, yellow incident days). Big percentage + incident count.

Public footer: "Public visibility only · No customer or provider data is shown."

---

### 18. Credit terms — `/credit-terms`

**Source**: `screens-misc.jsx :: ScreenCreditTerms`

**Header**: back btn + "Plug A Pro · Provider docs" eyebrow.

**Title** "Provider credits — terms & rules" (28/700) + subhead.

**Intro card** — gradient-soft bg, info glyph + plain-language summary.

**Sections card** — single card with multiple rows (1px dividers). Each row: H3 (15/700, -0.2 spacing) + body (13.5/500, mute, 1.6 line-height). 8 sections covering: definition, onboarding credits, accepting a job, preview behaviour, insufficient credits, top-ups, refunds, misuse.

**Support card** — WhatsApp green-tinted card with WA glyph + "Questions about your credits?" + "Open WhatsApp support" button.

**Print/save**: ensure this view is printable — no fixed header/footer issues, clean white bg in print stylesheet.
