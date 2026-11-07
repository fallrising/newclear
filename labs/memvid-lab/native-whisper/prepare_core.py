#!/usr/bin/env python3
"""Prepare a pinned Memvid crate with an explicit local-model-cache patch."""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request

VERSION = "2.0.140"
URL = f"https://static.crates.io/crates/memvid-core/memvid-core-{VERSION}.crate"
ARCHIVE_BYTES = 3104457
ARCHIVE_SHA256 = "c1d781d355751509b0a845a9203eb2db5a4e2b9750f193380439378a61080f85"
ORIGINAL_SHA256 = "e25a7fe293d60c0dca853edb61ff03aaaa35282a172bc1178aabdf56f05ff139"
PATCHED_SHA256 = "ec807f1192e355fd0a543af19a5827e8e88286576a9557df43438b7c15e551c1"
HERE = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def files(root: Path) -> dict[str, str]:
    result = {}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("source tree contains an unexpected symlink")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = digest(path)
    return result


def prepare(archive: Path | None = None) -> Path:
    work = HERE / "work"
    work.mkdir(exist_ok=True)
    if archive is None:
        archive = work / f"memvid-core-{VERSION}.crate"
        if not archive.exists():
            with tempfile.NamedTemporaryFile(dir=work, delete=False) as temp:
                temporary = Path(temp.name)
                try:
                    with urllib.request.urlopen(URL, timeout=90) as source:
                        data = source.read(ARCHIVE_BYTES + 1)
                    if len(data) != ARCHIVE_BYTES or hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
                        raise ValueError("Memvid crate archive does not match the source pin")
                    temp.write(data)
                    temp.flush()
                    temporary.rename(archive)
                finally:
                    temporary.unlink(missing_ok=True)
    if archive.stat().st_size != ARCHIVE_BYTES or digest(archive) != ARCHIVE_SHA256:
        raise ValueError("Memvid crate archive does not match the source pin")
    target = work / "memvid-core"
    with tempfile.TemporaryDirectory(prefix="source-", dir=work) as temporary:
        temporary = Path(temporary)
        with tarfile.open(archive) as source:
            source.extractall(temporary, filter="data")
        extracted = temporary / f"memvid-core-{VERSION}"
        path = extracted / "src/whisper.rs"
        if digest(path) != ORIGINAL_SHA256:
            raise ValueError("upstream Whisper source differs from the expected original")
        original = path.read_text()
        replacements = (
            (
                "use hf_hub::{Repo, RepoType, api::sync::Api};",
                "use hf_hub::{Repo, RepoType, api::sync::ApiBuilder};",
            ),
            (
                "let api = Api::new().map_err(|e| WhisperError::DownloadError {",
                'let api = ApiBuilder::from_cache(hf_hub::Cache::new(config.models_dir.join("hub")))\n'
                '                .with_token(None)\n'
                '                .with_progress(false)\n'
                '                .build().map_err(|e| WhisperError::DownloadError {',
            ),
        )
        patched = original
        for before, after in replacements:
            if patched.count(before) != 1:
                raise ValueError("the exact local-cache patch no longer applies")
            patched = patched.replace(before, after)
        patch = "".join(difflib.unified_diff(
            original.splitlines(keepends=True), patched.splitlines(keepends=True),
            fromfile="a/src/whisper.rs", tofile="b/src/whisper.rs", n=0,
        ))
        if patch != (HERE / "local-cache.patch").read_text():
            raise ValueError("documented patch and preparation code disagree")
        path.write_text(patched)
        if digest(path) != PATCHED_SHA256:
            raise ValueError("patched source checksum mismatch")
        (extracted / "MEMVID-LAB-PATCH.json").write_text(json.dumps({
            "source_url": URL, "archive_sha256": ARCHIVE_SHA256,
            "patch": "local-model-cache-v1", "original_whisper_sha256": ORIGINAL_SHA256,
            "patched_whisper_sha256": PATCHED_SHA256,
        }, indent=2) + "\n")
        if target.exists():
            if files(target) != files(extracted):
                raise ValueError("refusing to overwrite a changed prepared source tree")
        else:
            shutil.move(str(extracted), target)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="use an existing hash-verified crate archive")
    args = parser.parse_args()
    prepare(args.archive)
    print(json.dumps({"status": "passed", "core_version": VERSION, "core_patch": "local-model-cache-v1"}))


if __name__ == "__main__":
    main()
