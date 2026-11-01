#!/usr/bin/env python3
"""Run Makefile-equivalent Go gates with outputs in the shared task workspace."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--go", default="go")
parser.add_argument("--build-only", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
evidence = Path(os.environ["AGENT_EVIDENCE_DIR"])
artifacts = Path(os.environ["AGENT_ARTIFACTS_DIR"])
binary_dir = artifacts / "bin"
binary_dir.mkdir(exist_ok=True)
os.environ["CGO_ENABLED"] = "0"
manifest = {}
for path in sorted(root.rglob("*")):
    relative = path.relative_to(root)
    runtime_tree = relative.parts[0] in {"cmd", "internal", "schemas", "testdata", "scripts", "deploy", "examples", "contrib"}
    if path.is_file() and ((runtime_tree and path.suffix in {".go", ".sql", ".json", ".yaml", ".yml", ".py", ".html", ".css", ".js", ".mod", ".sum"})
                          or path.name in {"go.mod", "go.sum", "Makefile"} or path.name.startswith("Dockerfile")):
        manifest[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
source_id = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
(evidence / "source-manifest.json").write_text(json.dumps({"source_id": source_id, "go_version": subprocess.check_output([args.go, "version"], text=True).strip(), "files": manifest}, indent=2) + "\n")
commands = []
if not args.build_only:
    commands = [("test", [args.go, "test", "-count=1", "./..."]),
                ("example-test", [args.go, "-C", "examples/hello-healthz", "test", "-count=1", "./..."]),
                ("vet", [args.go, "vet", "./..."]),
                ("validate-schema", [args.go, "test", "-count=1", "./internal/fleetfile", "./internal/compose"])]
flags = "-s -w -X github.com/fallrising/newclear/specs/fleet/internal/version.Version=acceptance -X github.com/fallrising/newclear/specs/fleet/internal/version.Commit=" + source_id
commands += [(name, [args.go, "build", "-trimpath", "-ldflags=" + flags, "-o", str(binary_dir / name), "./cmd/" + name])
             for name in ("fleetd", "fleet-agent")]
commands += [("hello-healthz", [args.go, "-C", "examples/hello-healthz", "build", "-trimpath", "-o", str(binary_dir / "hello-healthz"), "."])]
for name, cmd in commands:
    print("RUN", name, flush=True)
    with (evidence / (name + ".log")).open("w") as log:
        log.write(json.dumps(cmd) + "\n")
        log.flush()
        result = subprocess.run(cmd, cwd=root, stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        print((evidence / (name + ".log")).read_text())
        raise SystemExit(result.returncode)
    print("PASS", name, flush=True)
print("SOURCE", source_id, flush=True)
