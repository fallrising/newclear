"""The deterministic, offline SDD lifecycle command line interface."""
from __future__ import annotations

import argparse
import ctypes
import errno
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from .sdd import validate_sdd

FILES = ("spec.md", "plan.md", "tasks.md", "verification.md")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]*$")
SDD_ID = re.compile(r"^SDD-[0-9]{4}$")
_AT_FDCWD = -100
_RENAME_NOREPLACE = 1
_RENAMEAT2_SYSCALLS = {
    "aarch64": 276,
    "armv7l": 382,
    "i386": 353,
    "i686": 353,
    "x86_64": 316,
}


def _root() -> Path:
    return Path.cwd().resolve()


def _templates(root: Path) -> Path:
    canonical = Path(__file__).resolve().parents[2] / "specs" / "templates"
    if canonical.is_dir() and root != canonical.parents[1]:
        return canonical
    candidate = root / "specs" / "templates"
    if candidate.is_dir():
        return candidate
    # This keeps source-checkout invocation usable from a temporary checkout.
    return canonical


def _safe_child(root: Path, path: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root)
        return True
    except ValueError:
        return False


def _publish_no_replace(staging: Path, target: Path) -> None:
    """Atomically publish ``staging`` only when ``target`` does not exist.

    Linux ``renameat2`` with ``RENAME_NOREPLACE`` is the required primitive;
    falling back to ``rename`` would permit an empty concurrent target to be
    replaced.
    """
    machine = os.uname().machine
    syscall_number = _RENAMEAT2_SYSCALLS.get(machine)
    if sys.platform != "linux" or syscall_number is None:
        raise OSError(errno.ENOSYS, "atomic no-replace publication is unavailable on this platform")
    libc = ctypes.CDLL(None, use_errno=True)
    result = libc.syscall(
        ctypes.c_long(syscall_number),
        ctypes.c_int(_AT_FDCWD), ctypes.c_char_p(os.fsencode(staging)),
        ctypes.c_int(_AT_FDCWD), ctypes.c_char_p(os.fsencode(target)),
        ctypes.c_uint(_RENAME_NOREPLACE),
    )
    if result != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(target))


def cmd_init(root: Path) -> int:
    templates = _templates(root)
    if not templates.is_dir() or any(not (templates / f).is_file() for f in FILES):
        print("init: canonical specs/templates are missing", file=sys.stderr)
        return 2
    active = root / "specs" / "active"
    config_dir = root / ".sdd"
    config = config_dir / "config.json"
    config_data = {"active": "specs/active", "templates": "specs/templates"}
    try:
        specs = root / "specs"
        destination = specs / "templates"
        if specs.is_symlink() or destination.is_symlink() or active.is_symlink() or config_dir.is_symlink():
            print("init: refusing symlinked repository directories", file=sys.stderr)
            return 2
        encoded = json.dumps(config_data, indent=2, sort_keys=True) + "\n"
        if config.exists():
            if config.is_symlink() or config.read_text(encoding="utf-8") != encoded:
                print(f"init: refusing to overwrite divergent {config}", file=sys.stderr)
                return 2
        if destination.exists() and not destination.is_dir():
            print(f"init: refusing non-directory {destination}", file=sys.stderr)
            return 2
        # Complete every conflict check before creating any repository file.
        if destination.is_dir():
            for name in FILES:
                target = destination / name
                source = templates / name
                if target.is_symlink() or (target.exists() and target.read_bytes() != source.read_bytes()):
                    print(f"init: refusing to overwrite divergent {target}", file=sys.stderr)
                    return 2
        specs.mkdir(exist_ok=True)
        active.mkdir(parents=True, exist_ok=True)
        config_dir.mkdir(exist_ok=True)
        if not config.exists():
            config.write_text(encoded, encoding="utf-8")
        destination.mkdir(parents=True, exist_ok=True)
        for name in FILES:
            target = destination / name
            if not target.exists():
                shutil.copyfile(templates / name, target)
    except OSError as exc:
        print(f"init: {exc}", file=sys.stderr)
        return 2
    print("initialized SDD repository")
    return 0


def _new_values(args: argparse.Namespace) -> tuple[str, str, str, str, str] | None:
    values = (args.slug, args.id, args.title, args.owner, args.component)
    if not all(values):
        print("new: --slug, --id, --title, --owner, and --component are required", file=sys.stderr)
        return None
    slug, ident, title, owner, component = values
    if not SLUG.fullmatch(slug):
        print("new: slug must contain lowercase letters, numbers, and single hyphens", file=sys.stderr)
        return None
    if not SDD_ID.fullmatch(ident):
        print("new: id must match SDD-NNNN", file=sys.stderr)
        return None
    if any(not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value
           for value in (title, owner, component)):
        print("new: title, owner, and component must be non-empty single-line values", file=sys.stderr)
        return None
    if not IDENT.fullmatch(owner) or not IDENT.fullmatch(component):
        print("new: owner and component must be safe identifiers", file=sys.stderr)
        return None
    return slug, ident, title, owner, component


def cmd_new(root: Path, args: argparse.Namespace) -> int:
    values = _new_values(args)
    if values is None:
        return 2
    slug, ident, title, owner, component = values
    active = root / "specs" / "active"
    target = active / slug
    if not _safe_child(root, target) or target.is_symlink() or target.exists():
        print(f"new: refusing to overwrite existing or unsafe target {target}", file=sys.stderr)
        return 2
    templates = _templates(root)
    if not templates.is_dir() or any(not (templates / f).is_file() for f in FILES):
        print("new: run 'sdd init' and ensure canonical templates exist", file=sys.stderr)
        return 2
    try:
        if active.is_symlink():
            print("new: refusing symlinked specs/active directory", file=sys.stderr)
            return 2
        active.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=f".{slug}.", dir=active) as staging_name:
            staging = Path(staging_name)
            replacements = {"<Feature title>": title, "<short feature title>": title, "SDD-0000": ident,
                            "<owner>": owner, "src/<component>": f"src/{component}"}
            for name in FILES:
                text = (templates / name).read_text(encoding="utf-8")
                for old, new in replacements.items():
                    text = text.replace(old, new)
                (staging / name).write_text(text, encoding="utf-8")
            result = validate_sdd(staging)
            if not result.valid or not result.data or result.data.get("title") != title:
                print(f"new: generated SDD is invalid for supplied values", file=sys.stderr)
                for issue in result.issues:
                    print(f"  {issue}", file=sys.stderr)
                return 2
            _publish_no_replace(staging, target)
    except OSError as exc:
        if exc.errno == errno.ENOSYS:
            print(f"new: atomic no-replace publication unavailable: {exc}", file=sys.stderr)
            return 2
        print(f"new: {exc}", file=sys.stderr)
        return 2
    print(f"created {target}")
    return 0


def _active(root: Path) -> list[Path]:
    directory = root / "specs" / "active"
    if not directory.is_dir() or directory.is_symlink():
        return []
    return [p for p in sorted(directory.iterdir(), key=lambda p: p.name)
            if p.is_dir() and not p.is_symlink()]


def cmd_validate(root: Path, name: str | None, all_active: bool) -> int:
    active_dir = root / "specs" / "active"
    if active_dir.is_symlink():
        print("validate: refusing symlinked specs/active directory", file=sys.stderr)
        return 2
    targets = _active(root) if all_active or name is None else [root / "specs" / "active" / name]
    if name is not None and (not SLUG.fullmatch(name) or not _safe_child(root, targets[0])):
        print(f"validate: unsafe SDD name '{name}'", file=sys.stderr)
        return 2
    if not targets:
        print("validate: no active SDDs found")
        return 0
    failures = 0
    for target in targets:
        result = validate_sdd(target)
        if result.valid:
            print(f"{target.name}: valid")
        else:
            failures += 1
            print(f"{target.name}: invalid")
            for issue in result.issues:
                print(f"  {issue}")
    return 1 if failures else 0


def cmd_status(root: Path, as_json: bool) -> int:
    rows = []
    for target in _active(root):
        result = validate_sdd(target)
        state = result.data.get("status") if result.data else None
        rows.append({"slug": target.name, "id": result.data.get("id") if result.data else None,
                     "status": state or "invalid", "valid": result.valid})
    if as_json:
        print(json.dumps(rows, sort_keys=True, separators=(",", ":")))
    else:
        for row in rows:
            print(f"{row['slug']}: {row['status']} ({'valid' if row['valid'] else 'invalid'})")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sdd")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    new = sub.add_parser("new")
    new.add_argument("slug_pos", nargs="?")
    for option in ("slug", "id", "title", "owner", "component"):
        new.add_argument(f"--{option}")
    validate = sub.add_parser("validate")
    validate.add_argument("name", nargs="?")
    validate.add_argument("--all", action="store_true", dest="all_active")
    status = sub.add_parser("status")
    status.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    if args.command == "new" and not args.slug:
        args.slug = args.slug_pos
    root = _root()
    return {"init": lambda: cmd_init(root), "new": lambda: cmd_new(root, args),
            "validate": lambda: cmd_validate(root, args.name, args.all_active),
            "status": lambda: cmd_status(root, args.as_json)}[args.command]()
