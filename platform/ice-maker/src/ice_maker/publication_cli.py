"""Non-interactive command line entry point for confined publication builds."""
from __future__ import annotations

import argparse
import json
import sys

from .publication_build import BuildError, build_publication


class _JsonArgumentParser(argparse.ArgumentParser):
    """Avoid argparse's usage text, which can reflect untrusted arguments."""

    def error(self, message: str) -> None:
        raise ValueError("invalid invocation")


def main(argv: list[str] | None = None) -> int:
    parser = _JsonArgumentParser(prog="ice-maker-publication", add_help=False)
    parser.add_argument("--repository-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--source-commit", required=True)
    try:
        args = parser.parse_args(argv)
        result = build_publication(args.repository_root, args.manifest, args.output_root, args.source_commit)
    except (BuildError, ValueError):
        print(json.dumps({"ok": False, "error": "publication_build_failed"}, separators=(",", ":")))
        return 2
    print(json.dumps({"ok": True, "manifest_id": result.book.manifest.manifest_id,
                      "outputs": [f"{result.book.manifest.manifest_id}/book.md",
                                  f"{result.book.manifest.manifest_id}/book.html"]}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
