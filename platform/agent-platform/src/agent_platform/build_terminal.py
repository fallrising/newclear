"""Build the fixed guest launcher from trusted package source, never execute it.

Requires a trusted local C compiler with static libc support. The output is a
private data file; only the guest setup installs its setuid mode. Pin its digest
in the private connector configuration, exactly like the template and Git bundle.
"""

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path


def build(output):
    source = Path(__file__).with_name("guest_terminal.c")
    with tempfile.TemporaryDirectory(prefix="agent-platform-launcher-") as root:
        binary = Path(root) / "terminal"
        subprocess.run(
            [
                "cc",
                "-static",
                "-O2",
                "-std=c11",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-fstack-protector-strong",
                "-D_FORTIFY_SOURCE=2",
                "-Wl,-z,noexecstack",
                "-o",
                str(binary),
                str(source),
            ],
            check=True,
            capture_output=True,
        )
        data = binary.read_bytes()
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
    return {
        "terminal_launcher_file": str(Path(output).absolute()),
        "terminal_launcher_sha256": hashlib.sha256(data).hexdigest(),
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(json.dumps(build(parser.parse_args().output), indent=2))


if __name__ == "__main__":
    main()
