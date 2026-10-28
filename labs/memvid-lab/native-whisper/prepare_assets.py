#!/usr/bin/env python3
"""Prepare hash-verified public fixtures; runtime does not download assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

MODEL_REVISION = "87c7102498dcde7456f24cfd30239ca606ed9063"
MODEL_CACHE = f"hf-home/hub/models--openai--whisper-tiny.en/snapshots/{MODEL_REVISION}"
MODEL_URL = f"https://huggingface.co/openai/whisper-tiny.en/resolve/{MODEL_REVISION}"
ASSETS = (
    {
        "file": f"{MODEL_CACHE}/config.json",
        "url": f"{MODEL_URL}/config.json",
        "bytes": 1937,
        "sha256": "b5366317df280f79e6cc366f259f379674f81a8721d458acf2e00680ccb10b1d",
        "license": "Apache-2.0 (official model card)",
    },
    {
        "file": f"{MODEL_CACHE}/tokenizer.json",
        "url": f"{MODEL_URL}/tokenizer.json",
        "bytes": 2405679,
        "sha256": "5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0",
        "license": "Apache-2.0 (official model card)",
    },
    {
        "file": f"{MODEL_CACHE}/model.safetensors",
        "url": f"{MODEL_URL}/model.safetensors",
        "bytes": 151060136,
        "sha256": "db59695928ded6043adaef491a53ef4e12da9611184d77c53baa691a60b958ad",
        "license": "Apache-2.0 (official model card)",
    },
    {
        "file": "jfk.flac",
        "url": "https://raw.githubusercontent.com/openai/whisper/86098128c0b4f24f0e2aa2994de830614b474227/tests/jfk.flac",
        "bytes": 1152693,
        "sha256": "63a4b1e4c1dc655ac70961ffbf518acd249df237e5a0152faae9a4a836949715",
        "license": "MIT (OpenAI Whisper repository); excerpt of a US federal speech",
    },
)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(root: Path) -> None:
    """Raise for missing or changed files; never silently redownload at runtime."""
    for item in ASSETS:
        path = root / item["file"]
        if not path.is_file() or path.stat().st_size != item["bytes"] or digest(path) != item["sha256"]:
            raise ValueError(f"missing or mismatched asset: {item['file']}")
    ref = root / "hf-home/hub/models--openai--whisper-tiny.en/refs/main"
    if ref.read_text() != MODEL_REVISION:
        raise ValueError("model cache revision does not match the pin")


def prepare(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    for item in ASSETS:
        target = root / item["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.stat().st_size != item["bytes"] or digest(target) != item["sha256"]:
                raise ValueError(f"refusing to overwrite mismatched asset: {item['file']}")
            continue
        fd, temporary = tempfile.mkstemp(prefix="download-", dir=target.parent)
        temporary = Path(temporary)
        try:
            with os.fdopen(fd, "wb") as output, urllib.request.urlopen(item["url"], timeout=90) as source:
                total = 0
                while chunk := source.read(1024 * 1024):
                    total += len(chunk)
                    if total > item["bytes"]:
                        raise ValueError(f"download exceeds pinned size: {item['file']}")
                    output.write(chunk)
            if temporary.stat().st_size != item["bytes"] or digest(temporary) != item["sha256"]:
                raise ValueError(f"download checksum mismatch: {item['file']}")
            # Do not replace a file another process created while downloading.
            os.link(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    ref = root / "hf-home/hub/models--openai--whisper-tiny.en/refs/main"
    ref.parent.mkdir(parents=True, exist_ok=True)
    if ref.exists():
        if ref.read_text() != MODEL_REVISION:
            raise ValueError("refusing to replace an unexpected cached model revision")
    else:
        with ref.open("x") as output:
            output.write(MODEL_REVISION)
    verify(root)
    (root / "manifest.json").write_text(json.dumps({"assets": ASSETS}, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if args.verify_only:
        verify(args.output)
    else:
        prepare(args.output)
    print(json.dumps({"status": "passed", "assets": len(ASSETS), "model_revision": MODEL_REVISION}))


if __name__ == "__main__":
    main()
