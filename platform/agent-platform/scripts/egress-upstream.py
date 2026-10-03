#!/usr/bin/env python3
"""Test exact, hash-verified upstream dialer code with deterministic UDP DNS.

Does not rebuild or replace sandboxd. Complements real binary KVM acceptance.
Only standard-library sections are extracted unchanged to avoid building the
unrelated cloud storage/cluster dependencies. Upstream source is AGPL-3.0; it is
read from an operator checkout and never vendored into this MIT repository.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

SOURCE_SHA256 = "4df2c7107a65b076af8d79568f8735298c12affcbcc3d4476a85b01878b1cae2"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="sandboxd/pool/egress.go")
    parser.add_argument("--go", default="go")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    raw = args.source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise RuntimeError("upstream_source_mismatch")
    source = raw.decode()
    definitions = source[source.index("var (") : source.index("type egressListener")]
    dialer = source[source.index("func newEgressDialer") :]
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="ap-egress-dns-") as directory:
        root = Path(directory)
        (root / "go.mod").write_text("module egress-contract\n\ngo 1.27.0\n")
        (root / "dialer.go").write_text(
            'package pool\nimport ("net";"net/netip";"syscall";"fmt";"slices")\n'
            + definitions
            + dialer
        )
        shutil.copyfile(
            Path(__file__).with_name("egress-contract") / "dialer_test.go", root / "dialer_test.go"
        )
        env = dict(os.environ, GOWORK="off", GOTOOLCHAIN="local")
        result = subprocess.run(
            [args.go, "test", "-count=1", "-v", "."],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        (args.output / "tests.log").write_text(result.stdout + result.stderr)
        report = {
            "upstream_revision": "de42fd50be5cdbfaaa6ddf890081566edb503d3c",
            "source_sha256": SOURCE_SHA256,
            "tests": 2,
            "passed": result.returncode == 0,
            "scope": "exact upstream dialer functions, real UDP DNS; no KVM claim",
        }
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
