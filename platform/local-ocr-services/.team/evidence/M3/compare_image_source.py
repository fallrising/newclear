#!/usr/bin/env python3
"""Compare an exported image source tree with the selected host snapshot."""

from __future__ import annotations

import argparse
from pathlib import Path


def terminal_newlines_removed(value: bytes) -> bytes:
    return value.rstrip(b"\r\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host-root", type=Path, default=Path.cwd())
    parser.add_argument("--image-root", type=Path, required=True)
    args = parser.parse_args()

    source_root = args.host_root / "src" / "ocr_service"
    paths = sorted(
        (path.relative_to(args.host_root) for path in source_root.rglob("*.py")),
        key=lambda path: path.as_posix(),
    )
    paths.extend((Path("requirements/base.txt"), Path("requirements/tesseract.txt")))

    exact_mismatches: list[str] = []
    non_newline_mismatches: list[str] = []
    for relative_path in paths:
        host_bytes = (args.host_root / relative_path).read_bytes()
        image_bytes = (args.image_root / relative_path).read_bytes()
        if host_bytes != image_bytes:
            exact_mismatches.append(relative_path.as_posix())
        if terminal_newlines_removed(host_bytes) != terminal_newlines_removed(image_bytes):
            non_newline_mismatches.append(relative_path.as_posix())

    print(f"compared={len(paths)}")
    print(f"exact_mismatches={len(exact_mismatches)}")
    print(f"exact_mismatch_paths={','.join(exact_mismatches)}")
    print(f"non_newline_mismatches={len(non_newline_mismatches)}")
    print(f"non_newline_mismatch_paths={','.join(non_newline_mismatches)}")
    if non_newline_mismatches:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
