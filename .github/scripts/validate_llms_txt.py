#!/usr/bin/env python3
"""Validate the repository's llms.txt capability files.

Checks the files that exist; absence is never an error. See
docs/specs/llms-txt.md for the format and the required keys.

Exit codes: 0 pass, 1 diagnostics failed, 2 could not complete.
"""

from __future__ import annotations

import posixpath
import re
import subprocess
import sys
from pathlib import Path

REQUIRED_KEYS = ["Tier", "Status", "Interfaces", "Entrypoint", "Auth", "Spec"]
TIER_VALUES = {"A", "B", "C", "D", "ungraded"}
# The README catalog writes an unassigned tier as 未分級; a capability file
# reports it as `ungraded`.
CATALOG_TIER_NAMES = {"未分級": "ungraded"}
STATUS_VALUES = {"production", "partial", "spec-only", "retired"}
INTERFACE_VALUES = {
    "http",
    "cli",
    "mcp",
    "grpc",
    "wire",
    "library",
    "desktop",
    "spec",
}

KEY_LINE = re.compile(r"^([A-Z][A-Za-z]*): *(.+)$")
# A root README catalog row: | [`products/goku`](products/goku/) | … | … | C |
CATALOG_ROW = re.compile(
    r"^\| *\[`(?P<path>[a-z0-9-]+/[a-z0-9-]+)`\]\([^)]*\).*\| *(?P<tier>[ABCD]|未分級) *\|? *$"
)
LIST_ITEM = re.compile(r"^- *\[")
LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
BLOB_PREFIX = "https://github.com/fallrising/newclear/blob/main/"


def tracked_files() -> set[str]:
    out = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout
    return set(out.splitlines())


def tracked_dirs(files: set[str]) -> set[str]:
    dirs = set()
    for path in files:
        parts = path.split("/")
        for i in range(1, len(parts)):
            dirs.add("/".join(parts[:i]))
    return dirs


def in_repo_target(url: str, base_dir: str = "") -> str | None:
    """Return the repository path a link points at, or None if external.

    Absolute repository URLs are taken as-is. A relative link resolves against
    the directory of the file that contains it, as a browser or an agent
    joining it to that file's URL would; a leading "/" means the repo root.
    """
    if url.startswith(BLOB_PREFIX):
        path = url[len(BLOB_PREFIX) :]
    elif url.startswith(("http://", "https://", "mailto:", "#")):
        return None
    elif url.startswith("/"):
        path = url.lstrip("/")
    else:
        path = posixpath.join(base_dir, url)
    path = path.split("#", 1)[0].split("?", 1)[0]
    path = posixpath.normpath(path) if path else path
    if path in ("", "."):
        return None
    return path.rstrip("/")


def catalog_tiers() -> dict[str, str]:
    """Component path -> doc tier, read from the root README catalog tables.

    The tier is assigned in the owner's private project ledger and surfaced
    here; a capability file may only report it. An unreadable README yields an
    empty mapping, which skips the cross-check rather than inventing a tier.
    """
    readme = Path("README.md")
    if not readme.is_file():
        return {}
    tiers: dict[str, str] = {}
    for line in readme.read_text(encoding="utf-8").splitlines():
        match = CATALOG_ROW.match(line.rstrip())
        if match:
            tier = match.group("tier")
            tiers[match.group("path")] = CATALOG_TIER_NAMES.get(tier, tier)
    return tiers


def check_file(
    path: str, files: set[str], dirs: set[str], tiers: dict[str, str]
) -> list[str]:
    """Validate one file. The root index is a different kind of file from a
    project capability file: it describes no single project, so the five keys
    do not apply to it. Its own obligation — linking every project file — is
    checked in main()."""
    errors: list[str] = []
    is_root_index = path == "llms.txt"
    base_dir = posixpath.dirname(path)
    text = Path(path).read_text(encoding="utf-8")
    lines = text.splitlines()

    h1 = [i for i, line in enumerate(lines) if line.startswith("# ")]
    if len(h1) != 1:
        errors.append(f"{path}: expected exactly one H1, found {len(h1)}")
        return errors
    if h1[0] != 0:
        errors.append(f"{path}: the H1 must be the first line")

    first_h2 = next(
        (i for i, line in enumerate(lines) if line.startswith("## ")), len(lines)
    )
    prose = lines[h1[0] + 1 : first_h2]

    found: list[tuple[str, str]] = []
    for line in prose:
        match = KEY_LINE.match(line)
        if match and match.group(1) in REQUIRED_KEYS:
            found.append((match.group(1), match.group(2).strip()))

    order = [key for key, _ in found]
    if is_root_index:
        if order:
            errors.append(
                f"{path}: the root index must not declare project keys, "
                f"found {order}"
            )
    else:
        missing = [key for key in REQUIRED_KEYS if key not in order]
        if missing:
            errors.append(f"{path}: missing required key(s): {', '.join(missing)}")
        elif order != REQUIRED_KEYS:
            errors.append(
                f"{path}: keys must appear in order {REQUIRED_KEYS}, found {order}"
            )

    values = dict(found)
    if "Tier" in values:
        declared_tier = values["Tier"]
        if declared_tier not in TIER_VALUES:
            errors.append(
                f"{path}: Tier must be one of {sorted(TIER_VALUES)}, "
                f"found {declared_tier!r}"
            )
        else:
            component = str(Path(path).parent)
            catalog_tier = tiers.get(component)
            if catalog_tier is None:
                errors.append(
                    f"{path}: {component} has no tier row in the README catalog"
                )
            elif catalog_tier != declared_tier:
                errors.append(
                    f"{path}: {component} declares Tier {declared_tier} but the "
                    f"README catalog assigns {catalog_tier}; the catalog wins"
                )
    if "Status" in values and values["Status"] not in STATUS_VALUES:
        errors.append(
            f"{path}: Status must be one of {sorted(STATUS_VALUES)}, "
            f"found {values['Status']!r}"
        )
    if "Interfaces" in values:
        declared = [item.strip() for item in values["Interfaces"].split(",")]
        # An entry may carry a parenthetical note, e.g. "library (Go SDK)".
        bare = [item.split("(", 1)[0].strip() for item in declared]
        unknown = [item for item in bare if item not in INTERFACE_VALUES]
        if unknown:
            errors.append(
                f"{path}: unknown interface kind(s) {unknown}; "
                f"accepted: {sorted(INTERFACE_VALUES)}"
            )
    if "Spec" in values:
        spec = values["Spec"]
        if not spec.lower().startswith("none"):
            for url in LINK.findall(spec) or [spec.strip()]:
                target = in_repo_target(url, base_dir)
                if target and target not in files and target not in dirs:
                    errors.append(f"{path}: Spec names a missing path: {target}")

    for i, line in enumerate(lines[first_h2:], start=first_h2):
        if line.startswith("- ") and not LIST_ITEM.match(line):
            errors.append(
                f"{path}:{i + 1}: list item under an H2 must start with a "
                f"markdown link"
            )

    # Every link in the file, including the prose block above the first H2,
    # where dormancy notes and successor pointers live.
    for url in LINK.findall("\n".join(lines)):
        target = in_repo_target(url, base_dir)
        if target and target not in files and target not in dirs:
            errors.append(f"{path}: broken in-repo link: {target}")

    return errors


def main() -> int:
    try:
        files = tracked_files()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"could not list tracked files: {exc}", file=sys.stderr)
        return 2

    dirs = tracked_dirs(files)
    targets = sorted(
        path
        for path in files
        if Path(path).name == "llms.txt" and not path.startswith("refs/")
    )
    if not targets:
        print("no llms.txt files tracked; nothing to validate")
        return 0

    tiers = catalog_tiers()
    errors: list[str] = []
    for path in targets:
        errors.extend(check_file(path, files, dirs, tiers))

    if "llms.txt" in files:
        root = Path("llms.txt").read_text(encoding="utf-8")
        for path in targets:
            if path == "llms.txt":
                continue
            if path not in root:
                errors.append(
                    f"llms.txt: root index does not link {path}"
                )
        # Every catalog component must be reachable from the root index. A
        # single-fetch index that silently omits a component is worse than no
        # index, and components land on main faster than anyone re-reads it.
        linked = {
            target
            for target in (in_repo_target(url) for url in LINK.findall(root))
            if target
        }
        for component in sorted(tiers):
            if not any(
                t == component or t.startswith(component + "/") for t in linked
            ):
                errors.append(
                    f"llms.txt: root index does not link catalog component "
                    f"{component}"
                )

    for error in errors:
        print(f"ERROR: {error}")
    print(f"{len(targets)} llms.txt file(s); {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
