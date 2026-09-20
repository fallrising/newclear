from __future__ import annotations

import ast
import sys
from pathlib import Path


def main(paths: list[str]) -> int:
    failures: list[str] = []
    checked = 0
    for raw_path in paths:
        for path in sorted(Path(raw_path).rglob("*.py")):
            checked += 1
            try:
                ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            except (OSError, SyntaxError, UnicodeError) as exc:
                failures.append(f"{path}: {exc}")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"syntax OK: {checked} Python files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
