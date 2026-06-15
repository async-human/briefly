"""Generate Briefly extension + store icons from the brand mark."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

# Brand palette (matches frontend/public/briefly-mark.svg)
GOLD_LIGHT = (221, 185, 106)
GOLD_MID = (196, 154, 60)
GOLD_DARK = (143, 102, 36)
BG = (250, 250, 248)
BG_EDGE = (235, 232, 226)

# Mark geometry in 32×32 viewBox
STEM = (10.25, 7.5, 10.25, 24.5)
LINES = (
    (14.0, 10.75, 24.25, 10.75, 0.95),
    (14.0, 15.5, 21.75, 15.5, 0.78),
    (14.0, 20.25, 18.75, 20.25, 0.58),
)


def _gold(opacity: float) -> tuple[int, int, int]:
    t = 1.0 - opacity * 0.35
    return (
        int(GOLD_LIGHT[0] * t + GOLD_MID[0] * (1 - t)),
        int(GOLD_LIGHT[1] * t + GOLD_MID[1] * (1 - t)),
        int(GOLD_LIGHT[2] * t + GOLD_MID[2] * (1 - t)),
    )


def _draw_rounded_square(
    draw: ImageDraw.ImageDraw,
    box: tuple[float, float, float, float],
    radius: float,
    fill: tuple[int, int, int],
    outline: tuple[int, int, int] | None = None,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)


def _draw_capsule(
    draw: ImageDraw.ImageDraw,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    width: float,
    color: tuple[int, int, int],
) -> None:
    draw.line((x1, y1, x2, y2), fill=color, width=max(1, int(round(width))), joint="curve")


def render_icon(size: int) -> Image.Image:
    scale = size / 32.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = max(1.0, size * 0.06)
    _draw_rounded_square(
        draw,
        (pad, pad, size - pad, size - pad),
        radius=max(2.0, size * 0.18),
        fill=BG,
        outline=BG_EDGE,
    )

    stroke_scale = max(0.85, scale * 0.92)
    stem_w = max(1.5, 1.75 * stroke_scale)
    _draw_capsule(
        draw,
        STEM[0] * scale,
        STEM[1] * scale,
        STEM[2] * scale,
        STEM[3] * scale,
        stem_w,
        _gold(1.0),
    )

    widths = (1.6, 1.5, 1.4)
    for (x1, y1, x2, y2, opacity), base_w in zip(LINES, widths, strict=True):
        _draw_capsule(
            draw,
            x1 * scale,
            y1 * scale,
            x2 * scale,
            y2 * scale,
            max(1.0, base_w * stroke_scale),
            _gold(opacity),
        )

    return img


def _save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.mode == "RGBA":
        flat = Image.new("RGB", img.size, BG)
        flat.paste(img, mask=img.split()[3])
        flat.save(path, "PNG", optimize=True)
    else:
        img.save(path, "PNG", optimize=True)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    ext_icons = root / "icons"
    store_icons = root / "store-assets"
    web_icons = root.parent / "frontend" / "public" / "icons"

    for size in (16, 48, 128):
        _save_png(render_icon(size), ext_icons / f"icon{size}.png")

    # Chrome Web Store listing icon (128×128) + high-res promo tile source
    _save_png(render_icon(128), store_icons / "store-icon-128.png")
    _save_png(render_icon(512), store_icons / "store-icon-512.png")

    for size in (192, 512):
        _save_png(render_icon(size), web_icons / f"icon{size}.png")

    print(f"Extension icons -> {ext_icons}")
    print(f"Store assets   -> {store_icons}")
    print(f"PWA icons      -> {web_icons}")


if __name__ == "__main__":
    main()
