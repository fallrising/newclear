"""Fixed workspace operations executed as the unprivileged guest account only."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/agentprobe/workspace")
LIMIT = 256 * 1024


def git(*args):
    return subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=always", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        timeout=30,
    ).stdout


def main():
    request = json.loads(sys.argv[1])
    if request["action"] == "checkout":
        ROOT.mkdir(mode=0o700)
        git("init", "--quiet")
        git("fetch", "--quiet", "/tmp/source.bundle", request["base_sha"])
        git("checkout", "--quiet", "--detach", request["base_sha"])
        actual = git("rev-parse", "HEAD").decode().strip()
        if actual != request["base_sha"]:
            raise RuntimeError("checkout_sha_mismatch")
        print(json.dumps({"base_sha": actual}))
        return
    os.chdir(ROOT)
    # Verification is a fixed, explicitly named fixture assertion, not repository tests.
    output = Path("m2-result.txt")
    expected = request["run_id"] + "\n"
    verified = (
        output.is_file()
        and not output.is_symlink()
        and output.stat().st_size < 100
        and output.read_text() == expected
    )
    # Include untracked files in the patch, without staging their contents or committing.
    git("add", "--intent-to-add", "--", ".")
    patch = git("diff", "--no-ext-diff", "--no-textconv", "--binary", request["base_sha"], "--")
    if len(patch) > LIMIT:
        raise RuntimeError("diff_limit_exceeded")
    print(
        json.dumps(
            {
                "base_sha": request["base_sha"],
                "diff": patch.decode("utf-8", errors="replace"),
                "diff_sha256": hashlib.sha256(patch).hexdigest(),
                "diff_bytes": len(patch),
                "verification": {
                    "status": "passed" if verified else "failed",
                    "name": "m2_fixture_workspace_assertion",
                    "exit_code": 0 if verified else 1,
                    "reason": "Fixed fixture assertion only; repository tests not configured.",
                },
                "workspace_value": output.read_text() if verified else None,
            }
        )
    )


if __name__ == "__main__":
    main()
