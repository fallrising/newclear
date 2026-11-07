#!/usr/bin/env python3
"""Exercise the compiled helper's credential guard before any model is loaded."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import tempfile

EXPECTED_ERROR = "HF_HOME contains a token entry; use a credential-free model cache"


def check(binary: Path) -> list[dict]:
    reports = []
    for kind in ("regular_file", "directory", "dangling_symlink"):
        with tempfile.TemporaryDirectory(prefix="memvid-whisper-token-guard-") as temporary:
            root = Path(temporary)
            # An invalid audio/model setup ensures a later initialization error cannot pass.
            audio = root / "unused-audio.flac"
            audio.write_bytes(b"not decoded in this negative guard test")
            token = root / "token"
            if kind == "regular_file":
                token.write_bytes(b"synthetic-credential-that-must-not-be-read")
                token.chmod(0)
            elif kind == "directory":
                token.mkdir()
            else:
                token.symlink_to(root / "nonexistent-token-target")
            result = subprocess.run(
                [str(binary.resolve()), str(audio)],
                env={"HF_HOME": str(root)}, capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 1 or result.stdout:
                raise AssertionError(f"{kind}: helper did not refuse the token entry")
            error = json.loads(result.stderr)
            if error != {"status": "failed", "error": EXPECTED_ERROR}:
                raise AssertionError(f"{kind}: helper did not reject before initialization")
            reports.append({"case": f"token_{kind}", "exit_code": 1, "error": EXPECTED_ERROR})
    return reports


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    print(json.dumps({"status": "passed", "cases": check(args.binary)}))


if __name__ == "__main__":
    main()
