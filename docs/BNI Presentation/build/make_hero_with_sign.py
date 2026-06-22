"""Composite the 'HANDYMAN PAINTER TILER' sign onto the provider hero image.

Mirrors the West Rand flyer treatment: sign in front of the man, slight tilt,
soft drop shadow, edges feathered so the busy source background blends with
the warehouse hero backdrop.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path("/Users/shimane/Projects/Plug A Pro/docs/INF Presentation")
BUILD = ROOT / "build"

HERO_SRC = BUILD / "hero_provider.png"
SIGN_SRC = ROOT / "CF3C2DF7-5FC4-43A5-A6AE-EF3FA90C3319.PNG"
OUT = BUILD / "hero_provider_with_sign.png"


def extract_sign(src: Image.Image) -> Image.Image:
    """Tight-crop the sign + post and feather the edges into transparency."""
    sw, sh = src.size
    # Crop tight to the sign board + visible post stub (CF3C2DF7 source).
    left = int(sw * 0.21)
    right = int(sw * 0.74)
    top = int(sh * 0.255)
    bottom = int(sh * 0.585)
    sign = src.crop((left, top, right, bottom)).convert("RGBA")

    w, h = sign.size

    # Two-zone alpha mask:
    #   - hard solid rectangle covering the sign board area (top 78%)
    #   - tapered ellipse around the post stub (bottom 22%)
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    board_bottom = int(h * 0.78)
    md.rectangle([int(w * 0.04), int(h * 0.05), int(w * 0.96), board_bottom], fill=255)
    # Post stub — narrow vertical band centred under the sign.
    post_x0 = int(w * 0.40)
    post_x1 = int(w * 0.55)
    md.rectangle([post_x0, board_bottom - 4, post_x1, int(h * 0.97)], fill=255)
    # Subtle blur — just enough to soften edges without bleeding background in.
    mask = mask.filter(ImageFilter.GaussianBlur(radius=int(min(w, h) * 0.025)))

    sign.putalpha(mask)

    # Slight clockwise tilt like the flyer.
    sign = sign.rotate(-4, resample=Image.BICUBIC, expand=True)
    return sign


def drop_shadow(img: Image.Image, offset=(14, 18), blur=22, opacity=140) -> Image.Image:
    """Return a shadow layer matching img's alpha, offset and blurred."""
    alpha = img.split()[-1]
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    shadow_alpha = Image.new("L", img.size, 0)
    shadow_alpha.paste(alpha, (0, 0))
    shadow_alpha = shadow_alpha.point(lambda v: min(v, opacity))
    black = Image.new("RGBA", img.size, (8, 14, 32, 255))
    black.putalpha(shadow_alpha)
    black = black.filter(ImageFilter.GaussianBlur(radius=blur))

    # Pad for offset
    pad = max(abs(offset[0]), abs(offset[1])) + blur
    canvas = Image.new("RGBA", (img.size[0] + pad * 2, img.size[1] + pad * 2), (0, 0, 0, 0))
    canvas.paste(black, (pad + offset[0], pad + offset[1]), black)
    canvas.paste(img, (pad, pad), img)
    return canvas


def main() -> None:
    hero = Image.open(HERO_SRC).convert("RGBA")
    hw, hh = hero.size

    sign_src = Image.open(SIGN_SRC).convert("RGBA")
    sign = extract_sign(sign_src)

    # Scale the sign so its width is roughly 27% of hero width — small enough
    # that the man stays visibly the main subject and the sign reads as a
    # secondary element beside him (matches the West Rand flyer treatment).
    target_w = int(hw * 0.27)
    scale = target_w / sign.size[0]
    sign = sign.resize((int(sign.size[0] * scale), int(sign.size[1] * scale)), Image.LANCZOS)

    sign = drop_shadow(sign, offset=(8, 14), blur=18, opacity=140)

    # Position: hip-to-knee level on the man's right (viewer's left), in the
    # open area between him and the soft blurred background. Light overlap
    # with his outer leg, not his torso.
    sx = int(hw * 0.34)
    sy = int(hh * 0.55)

    # Clamp inside canvas
    sx = max(0, min(sx, hw - sign.size[0]))
    sy = max(0, min(sy, hh - sign.size[1]))

    out = hero.copy()
    out.alpha_composite(sign, (sx, sy))

    out.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} ({out.size[0]}x{out.size[1]})")


if __name__ == "__main__":
    main()
