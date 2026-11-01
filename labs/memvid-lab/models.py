"""Explicit, hash-checked preparation of the lab's public model assets.

Only ``prepare`` downloads. ``verify_assets`` and model execution are local-only.
The asset manifest is deliberately code-reviewed rather than discovered at run time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request


BGE_REVISION = "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"
CLIP_REVISION = "0c311c620b36a2270b851db7bef9135f3eaae5d7"
IMAGE_REVISION = "e8a42ba85aaf5fd9322ef9ca51bc21063b22fcae"

ASSETS = (
    {
        "group": "semantic",
        "path": "bge-small-en-v1.5/model.onnx",
        "url": f"https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/{BGE_REVISION}/onnx/model.onnx",
        "revision": BGE_REVISION,
        "size_bytes": 133093490,
        "sha256": "828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35",
        "license": "MIT (BAAI model card)",
    },
    {
        "group": "semantic",
        "path": "bge-small-en-v1.5/tokenizer.json",
        "url": f"https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/{BGE_REVISION}/tokenizer.json",
        "revision": BGE_REVISION,
        "size_bytes": 711396,
        "sha256": "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
        "license": "MIT (BAAI model card)",
    },
    {
        "group": "clip",
        "path": "mobileclip-s2_text.onnx",
        "url": f"https://huggingface.co/Xenova/mobileclip_s2/resolve/{CLIP_REVISION}/onnx/text_model_fp16.onnx",
        "revision": CLIP_REVISION,
        "size_bytes": 127118306,
        "sha256": "0d6655b77515c4f1ccb8a4ab34ad312ead6d0e12fa68d00e327a1fe2637b4195",
        "license": "Other; Xenova model card links to apple/ml-mobileclip",
        "license_source": f"https://huggingface.co/Xenova/mobileclip_s2/blob/{CLIP_REVISION}/README.md",
    },
    {
        "group": "clip",
        "path": "mobileclip-s2_vision.onnx",
        "url": f"https://huggingface.co/Xenova/mobileclip_s2/resolve/{CLIP_REVISION}/onnx/vision_model_fp16.onnx",
        "revision": CLIP_REVISION,
        "size_bytes": 71710175,
        "sha256": "e011629d1490897f039fd8fbf1d6c677a03e0ffd1b5cea7cec5099bd8fea9476",
        "license": "Other; Xenova model card links to apple/ml-mobileclip",
        "license_source": f"https://huggingface.co/Xenova/mobileclip_s2/blob/{CLIP_REVISION}/README.md",
    },
    {
        "group": "clip",
        "path": "mobileclip-s2_tokenizer.json",
        "url": f"https://huggingface.co/Xenova/mobileclip_s2/resolve/{CLIP_REVISION}/tokenizer.json",
        "revision": CLIP_REVISION,
        "size_bytes": 2224081,
        "sha256": "72ed5c96db5729294468543e4bc75fce14ca63f58e37300290189ba1c1e52b85",
        "license": "Other; Xenova model card links to apple/ml-mobileclip",
        "license_source": f"https://huggingface.co/Xenova/mobileclip_s2/blob/{CLIP_REVISION}/README.md",
    },
    {
        "group": "clip",
        "path": "images/astronaut.png",
        "url": f"https://raw.githubusercontent.com/scikit-image/scikit-image/{IMAGE_REVISION}/skimage/data/astronaut.png",
        "revision": IMAGE_REVISION,
        "size_bytes": 791555,
        "sha256": "88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5",
        "license": "Public domain; NASA photograph of Eileen Collins",
        "license_source": f"https://github.com/scikit-image/scikit-image/blob/{IMAGE_REVISION}/skimage/data/_fetchers.py",
    },
    {
        "group": "clip",
        "path": "images/coffee.png",
        "url": f"https://raw.githubusercontent.com/scikit-image/scikit-image/{IMAGE_REVISION}/skimage/data/coffee.png",
        "revision": IMAGE_REVISION,
        "size_bytes": 466706,
        "sha256": "cc02f8ca188b167c775a7101b5d767d1e71792cf762c33d6fa15a4599b5a8de7",
        "license": "CC0; Rachel Michetti, courtesy of Pikolo Espresso Bar",
        "license_source": f"https://github.com/scikit-image/scikit-image/blob/{IMAGE_REVISION}/skimage/data/_fetchers.py",
    },
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _asset_path(cache: Path, relative: str) -> Path:
    # A poisoned/symlinked cache must not redirect a write or model load.
    if any(parent.is_symlink() for parent in (cache, *cache.parents)):
        raise ValueError("The model cache must not traverse a symlink")
    path = cache / relative
    current = cache
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"Model asset must not be a symlink: {relative}")
    return path


def _verify(path: Path, asset: dict) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Missing prepared asset: {asset['path']}; run models.py prepare")
    if path.stat().st_size != asset["size_bytes"] or sha256_file(path) != asset["sha256"]:
        raise ValueError(f"Asset checksum mismatch: {asset['path']}; existing bytes were not replaced")


def verify_assets(cache: Path, group: str | None = None) -> dict:
    """Verify pinned local bytes, without network access or silent repair."""
    cache = Path(os.path.abspath(cache))
    assets = [dict(asset) for asset in ASSETS if group is None or asset["group"] == group]
    if not assets:
        raise ValueError(f"Unknown asset group: {group}")
    for asset in assets:
        _verify(_asset_path(cache, asset["path"]), asset)
    return {"schema_version": 1, "assets": assets, "total_bytes": sum(a["size_bytes"] for a in assets)}


def prepare(cache: Path) -> dict:
    """Download missing fixed assets, checking size and SHA before publication.

    Valid existing files are reused. An existing invalid file is an error, never
    an implicit overwrite. Model payloads are not checked into the repository.
    """
    cache = Path(os.path.abspath(cache))
    _asset_path(cache, "manifest.json")
    cache.mkdir(parents=True, exist_ok=True)
    for asset in ASSETS:
        destination = _asset_path(cache, asset["path"])
        if destination.exists():
            _verify(destination, asset)
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".download-", delete=False) as stream:
                temporary = Path(stream.name)
                request = urllib.request.Request(asset["url"], headers={"User-Agent": "memvid-lab/1"})
                with urllib.request.urlopen(request, timeout=60) as response:
                    received = 0
                    while block := response.read(1024 * 1024):
                        received += len(block)
                        if received > asset["size_bytes"]:
                            raise ValueError(f"Download exceeds pinned size: {asset['path']}")
                        stream.write(block)
            _verify(temporary, asset)
            # Hard-link publication is atomic and fails if another file won the race.
            os.link(temporary, destination)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    manifest = verify_assets(cache)
    manifest_path = cache / "manifest.json"
    expected = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if manifest_path.exists():
        if manifest_path.read_text(encoding="utf-8") != expected:
            raise ValueError("Existing model manifest differs; it was not overwritten")
    else:
        with manifest_path.open("x", encoding="utf-8") as stream:
            stream.write(expected)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "verify"))
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    result = prepare(args.cache) if args.command == "prepare" else verify_assets(args.cache)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
