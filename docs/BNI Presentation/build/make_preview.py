"""Render a 1920x1080 PNG preview of the BNI intro slide.

Independent of LibreOffice / Keynote. Mirrors the same layout, colours and
content as make_slide.py so the preview accurately represents the .pptx.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path("/Users/shimane/Projects/Plug A Pro/docs/INF Presentation/build")
OUT = Path(
    "/Users/shimane/Projects/Plug A Pro/docs/INF Presentation/plugapro_bni_intro_slide.png"
)

W, H = 1920, 1080  # 16:9 preview

NAVY = (0x0B, 0x1B, 0x3F)
NAVY_SOFT = (0x11, 0x2C, 0x58)
NAVY_DEEP = (0x06, 0x11, 0x2A)
GREEN = (0x1E, 0x8E, 0x5A)
GREEN_SOFT = (0x2B, 0xB6, 0x73)
ACCENT = (0xE0, 0x7A, 0x2C)
PAPER = (0xFF, 0xFF, 0xFF)
PAPER_SOFT = (0xF6, 0xF8, 0xFC)
MUTED = (0x6B, 0x76, 0x90)
DIVIDER = (0xE0, 0xE4, 0xEE)
TEXT_LIGHT = (0xDD, 0xE3, 0xF1)

# Try several common macOS font paths so the preview renders even without
# specifying full paths. Falls back to PIL default if none found.
FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Avenir.ttc",
    "/Library/Fonts/Arial.ttf",
]


def font(size: int, bold: bool = False, italic: bool = False) -> ImageFont.ImageFont:
    for p in FONT_CANDIDATES:
        try:
            fnt = ImageFont.truetype(p, size=size, index=1 if bold else 0)
            return fnt
        except Exception:
            continue
    return ImageFont.load_default()


def rounded(draw: ImageDraw.ImageDraw, xy, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def text_centered(draw, xy_box, text, fnt, fill):
    x0, y0, x1, y1 = xy_box
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((x0 + x1 - tw) / 2 - bbox[0], (y0 + y1 - th) / 2 - bbox[1]), text, font=fnt, fill=fill)


def build_navy_bg() -> Image.Image:
    img = Image.new("RGB", (W, H), NAVY)
    grad = Image.new("RGB", (1, H))
    for y in range(H):
        t = y / H
        r = int(NAVY[0] + (NAVY_DEEP[0] - NAVY[0]) * t)
        g = int(NAVY[1] + (NAVY_DEEP[1] - NAVY[1]) * t)
        b = int(NAVY[2] + (NAVY_DEEP[2] - NAVY[2]) * t)
        grad.putpixel((0, y), (r, g, b))
    img.paste(grad.resize((W, H)), (0, 0))

    highlight = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    cx, cy, rad = int(W * 0.10), int(H * 0.18), int(W * 0.30)
    for r in range(rad, 0, -2):
        a = int(45 * (1 - r / rad))
        hd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, a))
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=30))
    img.paste(highlight, (0, 0), highlight)

    return img


def hero_panel(width: int, height: int) -> Image.Image:
    src = Image.open(ROOT / "hero_provider_with_sign.png").convert("RGB")
    sw, sh = src.size
    scale = max(width / sw, height / sh)
    resized = src.resize((int(sw * scale), int(sh * scale)), Image.LANCZOS)
    horiz_overflow = max(0, resized.size[0] - width)
    left = int(horiz_overflow * 0.62)
    top = (resized.size[1] - height) // 2
    panel = resized.crop((left, top, left + width, top + height))

    # Bottom vignette
    vig = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vig)
    h0 = int(height * 0.45)
    for i, y in enumerate(range(h0, height)):
        alpha = int(150 * (i / (height - h0)))
        vd.line([(0, y), (width, y)], fill=(6, 12, 28, alpha))
    panel = panel.convert("RGBA")
    panel = Image.alpha_composite(panel, vig)

    # Left edge fade into navy for clean seam
    edge = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    fade_w = int(width * 0.16)
    for x in range(fade_w):
        alpha = int(240 * (1 - x / fade_w) ** 1.4)
        ed.line([(x, 0), (x, height)], fill=(*NAVY, alpha))
    panel = Image.alpha_composite(panel, edge)
    return panel.convert("RGB")


def build() -> None:
    img = build_navy_bg()
    draw = ImageDraw.Draw(img, "RGBA")

    # ----- Panel split -----
    content_w = int(W * 0.578)  # ~57.8% navy
    photo_w = W - content_w

    # Hero on the right
    hero = hero_panel(photo_w, H)
    img.paste(hero, (content_w, 0))

    # Thin green seam
    draw.rectangle([content_w - 4, 0, content_w + 4, H], fill=GREEN_SOFT)

    # ----- Logo top-left -----
    logo = Image.open(ROOT / "logo.png").convert("RGBA")
    lw, lh = logo.size
    target_h = 110
    scale = target_h / lh
    logo = logo.resize((int(lw * scale), target_h), Image.LANCZOS)
    img.paste(logo, (80, 60), logo)

    # Small tagline
    draw.text(
        (84, 60 + target_h + 18),
        "LOCAL SERVICES MARKETPLACE  ·  WHATSAPP-FIRST",
        font=font(18, bold=True),
        fill=GREEN_SOFT,
    )

    # ----- Headline -----
    h_top = 280
    draw.text((80, h_top), "Connecting Local Skills", font=font(82, bold=True), fill=PAPER)
    draw.text((80, h_top + 100), "to Local Work.", font=font(82, bold=True), fill=GREEN_SOFT)

    # Pill
    pill_x0, pill_y0 = 80, h_top + 230
    pill_x1, pill_y1 = pill_x0 + 690, pill_y0 + 70
    rounded(draw, (pill_x0, pill_y0, pill_x1, pill_y1), radius=35, fill=NAVY_DEEP, outline=GREEN_SOFT, width=2)
    text_centered(
        draw,
        (pill_x0, pill_y0, pill_x1, pill_y1),
        "Home & business maintenance, booked on WhatsApp",
        font(20, bold=True),
        PAPER,
    )

    # Description
    desc_y = pill_y1 + 40
    desc_lines = [
        "Plug A Pro is a simple way for households and businesses",
        "to find local service providers — from plumbing and",
        "electrical work to handywork, painting, and beyond.",
        "Customers send 'JOIN' on WhatsApp, we route the job to",
        "nearby providers, and updates flow back as the work moves.",
    ]
    line_h = 32
    for i, line in enumerate(desc_lines):
        draw.text((80, desc_y + i * line_h), line, font=font(20), fill=TEXT_LIGHT)

    # BNI chip
    bni_x0, bni_y0 = 80, H - 110
    bni_x1, bni_y1 = bni_x0 + 580, bni_y0 + 56
    rounded(draw, (bni_x0, bni_y0, bni_x1, bni_y1), radius=28, fill=ACCENT)
    text_centered(
        draw,
        (bni_x0, bni_y0, bni_x1, bni_y1),
        "BNI Prosper-Us  ·  Visitor Introduction  ·  Lebogang",
        font(16, bold=True),
        PAPER,
    )

    # ----- Floating QR card on photo -----
    card_w, card_h = 425, 525
    card_x = W - card_w - 36
    card_y = H - card_h - 36

    # Shadow
    rounded(draw, (card_x + 12, card_y + 16, card_x + 12 + card_w, card_y + 16 + card_h), radius=18, fill=(5, 13, 34, 200))
    # Card
    rounded(draw, (card_x, card_y, card_x + card_w, card_y + card_h), radius=18, fill=PAPER, outline=NAVY, width=2)

    # Header
    header_h = 64
    rounded(draw, (card_x, card_y, card_x + card_w, card_y + header_h + 14), radius=14, fill=GREEN)
    draw.rectangle((card_x, card_y + 14, card_x + card_w, card_y + header_h), fill=GREEN)
    text_centered(
        draw,
        (card_x, card_y, card_x + card_w, card_y + header_h),
        "SCAN TO LEARN MORE",
        font(18, bold=True),
        PAPER,
    )

    # QR
    qr = Image.open(ROOT / "qr_plugapro.png").convert("RGB")
    qr_size = 270
    qr = qr.resize((qr_size, qr_size), Image.LANCZOS)
    qr_x = card_x + (card_w - qr_size) // 2
    qr_y = card_y + header_h + 18
    img.paste(qr, (qr_x, qr_y))

    # "or join the local rollout"
    draw.text(
        (card_x + 50, qr_y + qr_size + 4),
        "or join the local rollout",
        font=font(16, italic=True),
        fill=MUTED,
    )

    # Divider line
    draw.rectangle((card_x + 40, qr_y + qr_size + 42, card_x + card_w - 40, qr_y + qr_size + 44), fill=DIVIDER)

    # WhatsApp row
    contact_y = qr_y + qr_size + 56
    rounded(draw, (card_x + 40, contact_y, card_x + 40 + 44, contact_y + 44), radius=22, fill=GREEN)
    text_centered(draw, (card_x + 40, contact_y, card_x + 40 + 44, contact_y + 44), "WA", font(13, bold=True), PAPER)
    draw.text((card_x + 40 + 60, contact_y + 10), "+27 69 355 2447", font=font(21, bold=True), fill=NAVY)

    # Website row
    web_y = contact_y + 60
    rounded(draw, (card_x + 40, web_y, card_x + 40 + 44, web_y + 44), radius=22, fill=NAVY)
    text_centered(draw, (card_x + 40, web_y, card_x + 40 + 44, web_y + 44), ".za", font(11, bold=True), PAPER)
    draw.text((card_x + 40 + 60, web_y + 10), "plugapro.co.za", font=font(21, bold=True), fill=NAVY)

    img.save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT}  ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    build()
