# GPT Task Instruction — Generate West Rand Campaign Ad Images

## Your role

You are generating photorealistic ad images for **Plug A Pro**, a South African home-services platform launching paid Facebook/Instagram ads in the West Rand of Johannesburg (Northcliff, Honeydew, Florida, Randpark Ridge, Constantia Kloof, Discovery). The full campaign spec is attached — Section 3 (Creative Briefs) and Section 5 (Designer Brief) are your source of truth. Where this instruction and the spec conflict, follow the spec.

## Hard rules — apply to every image

1. **NO text in any image.** No words, no logos, no watermarks, no signage with readable text. All copy and overlays are added later in Canva. This is critical for Meta's 20% text rule and because the text gets added separately per placement.
2. **South African context.** Homes must look like real Johannesburg West Rand suburbs: face-brick or plastered single-storey homes, tiled roofs, boundary walls with gates, well-kept gardens. Not American suburbs, not European apartments, not mansions, not informal housing.
3. **People must be diverse and representative of South Africa.** Tradespeople in clean, neat workwear (golf shirt or overall, no visible brand text).
4. **Photorealistic style** — natural light, shot-on-camera feel, shallow depth of field where suitable. Not illustration, not 3D render, except Creative 6 which is a flat graphic.
5. **Composition: leave negative space** in the centre-third (vertical formats) or upper-third (square formats) where overlay text will be placed later.
6. **Two formats per creative** unless stated otherwise:
   - Feed: **1080×1080 (square)**
   - Stories: **1080×1920 (vertical)** — keep key subject matter in the middle 60% of the frame; top 250px and bottom 310px will be covered by Instagram UI and CTA elements.

## Generate these images

### Creative 1 — Dripping tap (urgent tone)
- Close-up of a chrome tap dripping, or a brown water stain spreading on a white ceiling.
- Dark, moody, slightly underexposed. Real household bathroom/kitchen — visible wear, not a showroom.
- Feeling: "this is getting worse and nobody is coming."
- Formats: square + vertical.

### Creative 2 — Tradesperson at the gate (trust tone)
- A tradesperson in a clean plain uniform standing at the front gate of a typical West Rand suburban home, toolbox in hand, confident relaxed posture, slight smile.
- Daytime, natural light, face-brick house with a neat garden visible behind the gate.
- Feeling: "a professional you can trust has arrived."
- Formats: square + vertical.

### Creative 3 — Freshly painted interior (aspirational tone)
- A bright, freshly painted living room or bedroom interior. Warm afternoon light through a window. Clean lines, a plant or two, modest furniture.
- A real middle-class South African home — inviting, achievable, not a luxury show house.
- Feeling: "my home could look like this."
- Formats: square + vertical.

### Creative 4 — Carousel (4 separate square images, 1080×1080 each)
- **Card 1:** Painter mid-stroke on an interior wall, roller in hand, neat drop cloth below.
- **Card 2:** Sparkling clean modern kitchen or bathroom, post-clean, gleaming surfaces.
- **Card 3:** Handyman fixing a door hinge or cupboard, focused, tools neatly laid out.
- **Card 4:** Flat graphic — solid brand-colour background, empty centre (logo and CTA text added later in Canva). Generate as a clean gradient or solid colour field with subtle texture only.

### Creative 5 — Before/after split (transformation tone)
- One image, vertically split down the middle: LEFT half a faded, scuffed, tired room; RIGHT half the same room freshly painted and clean.
- Same camera angle both sides so the split reads as one room transformed. Leave a clean 20px vertical gap at the centre line (brand colour divider added later).
- Formats: square + vertical.

### Creative 6 — Area launch graphic (announcement tone)
- Flat minimal graphic, NOT photorealistic: a single location-pin icon centred on a clean solid background, subtle map-contour lines in the background at low opacity.
- No text — suburb names get added later.
- Formats: square + vertical.

### Creative 7 — Video storyboard stills (6 frames, square)
Generate 6 still frames matching the 20-second storyboard in spec Section 3 (used as a shot-reference for the video editor):
1. Dark moody empty hallway with a phone on a side table (sets up "still waiting").
2. Quick-cut subject: dripping tap close-up (can reuse Creative 1 angle, different crop).
3. Cracked or broken cupboard hinge close-up.
4. Frustrated homeowner sitting at a kitchen table looking at their phone.
5. Hands holding a phone, screen blank/empty (UI screenshot composited later).
6. Same tradesperson from Creative 2 arriving at the gate, wide shot.

## Output checklist

| # | Creative | Files |
|---|----------|-------|
| 1 | Dripping tap | 1 square + 1 vertical |
| 2 | Tradesperson at gate | 1 square + 1 vertical |
| 3 | Painted interior | 1 square + 1 vertical |
| 4 | Carousel | 4 square |
| 5 | Before/after split | 1 square + 1 vertical |
| 6 | Area launch graphic | 1 square + 1 vertical |
| 7 | Video storyboard | 6 square stills |

**Total: 20 images.** Name them `PAP-[creative#]-[v1]-[feed|stories].png` (storyboard: `PAP-7-frame[1-6].png`).

## Process

Generate one creative at a time and wait for approval before moving to the next. If a generation drifts from the spec (wrong housing style, text appearing in image, wrong mood), regenerate before presenting. Start with Creative 1.
