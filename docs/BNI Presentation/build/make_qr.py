"""Generate a high-contrast QR code for plugapro.co.za."""
from __future__ import annotations

import qrcode
from qrcode.constants import ERROR_CORRECT_H

URL = "https://plugapro.co.za"
OUT = "/Users/shimane/Projects/Plug A Pro/docs/INF Presentation/build/qr_plugapro.png"


def main() -> None:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=24,
        border=2,
    )
    qr.add_data(URL)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0B1B3F", back_color="white").convert("RGB")
    img.save(OUT, "PNG")
    print(f"Wrote {OUT} ({img.size[0]}x{img.size[1]}) for {URL}")


if __name__ == "__main__":
    main()
