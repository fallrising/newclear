#!/usr/bin/env python3
"""Check enabled root workflows with the pinned, digest-verified actionlint."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2]
PIN = SOURCE / ".github/actionlint.json"
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_BINARY_BYTES = 50 * 1024 * 1024


def platform_key():
    machine = {"x86_64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    return f"{platform.system().lower()}_{machine}"


def verify_archive(data, expected):
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise ValueError(f"SHA256 mismatch: expected {expected}, got {actual}")
    return data


def archive_bytes(pin, cache, supplied=None):
    key = platform_key()
    if key not in pin["sha256"]:
        raise ValueError(f"unsupported verifier platform: {key}; supported: {', '.join(pin['sha256'])}")
    digest = pin["sha256"][key]
    name = f"actionlint_{pin['version']}_{key}.tar.gz"
    if supplied is not None:
        data = supplied.read_bytes()
    else:
        target = cache / name
        if target.exists():
            data = target.read_bytes()
        else:
            url = f"{pin['download_base']}/{name}"
            print(f"DOWNLOAD: {url}", flush=True)
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(MAX_ARCHIVE_BYTES + 1)
            if len(data) > MAX_ARCHIVE_BYTES:
                raise ValueError("release archive exceeds download bound")
            verify_archive(data, digest)
            with tempfile.NamedTemporaryFile(dir=cache, prefix="download-", delete=False) as stream:
                temporary = Path(stream.name)
                try:
                    stream.write(data)
                    stream.flush()
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ValueError("release archive exceeds size bound")
    return verify_archive(data, digest)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=SOURCE)
    parser.add_argument("--cache-dir", type=Path,
                        default=os.environ.get("ACTIONLINT_CACHE_DIR") or os.environ.get("AGENT_BUILD_DIR"),
                        help="verifier cache outside source (or ACTIONLINT_CACHE_DIR/AGENT_BUILD_DIR)")
    parser.add_argument("--archive", type=Path, help="use an existing release archive offline; digest is still checked")
    parser.add_argument("paths", nargs="*", type=Path, help="specific workflow files; default: root .github/workflows/*.yml,*.yaml")
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve()
        paths = [p.resolve() if p.is_absolute() else (root / p).resolve() for p in args.paths]
        if not paths:
            directory = root / ".github/workflows"
            paths = sorted(p for p in directory.glob("*") if p.suffix in (".yml", ".yaml") and p.is_file())
        if not paths:
            raise ValueError("no root workflow files found")
        if args.cache_dir is None:
            raise ValueError("set --cache-dir, ACTIONLINT_CACHE_DIR or AGENT_BUILD_DIR outside the source tree")
        cache = args.cache_dir.resolve()
        if cache == SOURCE or SOURCE in cache.parents or cache == root or root in cache.parents:
            raise ValueError("verifier cache must be outside the source tree")
        cache.mkdir(parents=True, exist_ok=True)
        pin = json.loads(PIN.read_text(encoding="utf-8"))
        data = archive_bytes(pin, cache, args.archive)
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            member = archive.getmember("actionlint")
            if not member.isfile() or member.size > MAX_BINARY_BYTES:
                raise ValueError("release does not contain a bounded regular actionlint executable")
            binary = archive.extractfile(member).read(MAX_BINARY_BYTES + 1)
        # A fresh private directory prevents execution of a stale/tampered cached binary.
        with tempfile.TemporaryDirectory(dir=cache, prefix="verified-") as temp:
            executable = Path(temp) / "actionlint"
            executable.write_bytes(binary)
            executable.chmod(0o700)
            print(f"CHECK: actionlint {pin['version']} ({len(paths)} root/explicit workflow files)", flush=True)
            result = subprocess.run(
                [str(executable), "-color=false", "-shellcheck=", "-pyflakes=", *map(str, paths)],
                cwd=root, timeout=120,
            )
        if result.returncode:
            return 1
        print(f"PASS: {len(paths)} workflow(s); actionlint {pin['version']}")
        return 0
    except (OSError, ValueError, KeyError, tarfile.TarError, subprocess.TimeoutExpired) as exc:
        print(f"ERROR: workflow lint could not complete: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
