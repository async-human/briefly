"""Generate minimal Briefly extension icons (gold gradient square)."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, rgb: tuple[int, int, int]) -> None:
    r, g, b = rgb
    raw = b""
    for _ in range(size):
        raw += b"\x00" + bytes([r, g, b]) * size

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    repo = Path(__file__).resolve().parent.parent.parent
    ext_out = repo / "extension" / "icons"
    web_out = repo / "frontend" / "public" / "icons"
    ext_out.mkdir(parents=True, exist_ok=True)
    web_out.mkdir(parents=True, exist_ok=True)
    color = (154, 123, 79)  # Briefly brand gold
    for size in (16, 48, 128):
        write_png(ext_out / f"icon{size}.png", size, color)
    for size in (192, 512):
        write_png(web_out / f"icon{size}.png", size, color)
    print(f"Wrote extension icons to {ext_out}")
    print(f"Wrote PWA icons to {web_out}")


if __name__ == "__main__":
    main()
