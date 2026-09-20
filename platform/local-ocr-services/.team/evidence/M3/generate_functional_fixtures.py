#!/usr/bin/env python3
"""Generate checksum-fixed synthetic M3 OCR fixtures from a private text file."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FIXTURES = (
    (
        "traditional.png",
        (1200, 300),
        "a6d70dbf0a1475c36f4f9260789f639ba441152dacc6cdd5fb7226530c8049b3",
    ),
    (
        "english.png",
        (1600, 400),
        "9d2fbd41922f8ef21fa6ba285cc85b4faf1c90144dd056180bf92b461d4fd983",
    ),
)
FONT_PATH = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-text-file", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    texts = args.private_text_file.read_text(encoding="utf-8").splitlines()
    if len(texts) != len(FIXTURES) or any(not value for value in texts):
        raise SystemExit("private fixture source must contain exactly two non-empty lines")
    if not FONT_PATH.is_file():
        raise SystemExit(f"required font is absent: {FONT_PATH}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(FONT_PATH), 72, index=0)
    for (name, dimensions, expected_sha256), text in zip(FIXTURES, texts, strict=True):
        image = Image.new("RGB", dimensions, "white")
        ImageDraw.Draw(image).text((50, 90), text, fill="black", font=font)
        path = args.output_dir / name
        image.save(path, format="PNG")
        actual_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_sha256 != expected_sha256:
            raise SystemExit(f"generated checksum mismatch for {name}")

    print("generated_fixtures=2 checksums=passed private_text=not_printed")


if __name__ == "__main__":
    main()
