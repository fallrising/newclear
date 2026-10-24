#!/usr/bin/env python3
"""Provision or run Kith's local pixel gate; invoke through the shared workspace launcher."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request

NODE = "24.18.0"
NODE_ARCHIVE = "node-v24.18.0-linux-x64.tar.xz"
NODE_SHA256 = "55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"
IMAGE = "mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e"
KITH = Path(__file__).resolve().parents[2]
REPO = Path(subprocess.check_output(["git", "-C", str(KITH), "rev-parse", "--show-toplevel"], text=True).strip())


def run(argv, **kwargs):
    subprocess.run([str(x) for x in argv], check=True, **kwargs)


def owned(name):
    value = os.environ.get(name)
    if not value or not Path(value).is_absolute():
        raise SystemExit("Use the shared launcher: missing absolute " + name)
    return Path(value)


def provision(task):
    build = owned("AGENT_BUILD_DIR")
    if (task / "visual-runtime.json").exists():
        raise SystemExit("Runtime receipt exists; use a fresh launcher task for provisioning")
    archive = build / NODE_ARCHIVE
    with urllib.request.urlopen("https://nodejs.org/dist/v" + NODE + "/" + NODE_ARCHIVE, timeout=120) as response:
        with archive.open("xb") as output:
            shutil.copyfileobj(response, output)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != NODE_SHA256:
        raise SystemExit("Node archive checksum mismatch")
    with tarfile.open(archive) as source:
        source.extractall(build, filter="data")
    env = {**os.environ, "PATH": str(build / ("node-v" + NODE + "-linux-x64/bin")) + ":" + os.environ["PATH"]}
    for part, source in [("root", KITH), ("web", KITH / "web"), ("e2e", KITH / "e2e")]:
        destination = build / part
        destination.mkdir(exist_ok=False)
        for name in ["package.json", "package-lock.json"]:
            shutil.copyfile(source / name, destination / name)
        run(["npm", "ci", "--prefix", destination, "--no-audit", "--no-fund"], env=env)
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(task / "cache/playwright")
    run([build / "e2e/node_modules/.bin/playwright", "install", "chromium"], env=env)
    run(["docker", "pull", IMAGE])
    receipt = {"node": NODE, "node_archive_sha256": NODE_SHA256, "image": IMAGE, "playwright": "1.56.1", "chromium_revision": 1194,
               "locks": {str(p.relative_to(KITH)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [KITH / "package-lock.json", KITH / "web/package-lock.json", KITH / "e2e/package-lock.json"]}}
    (task / "visual-runtime.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("Provisioned runtime:", task)


def gate(task, runtime, mode, candidate, focus):
    build, evidence, artifacts = owned("AGENT_BUILD_DIR"), owned("AGENT_EVIDENCE_DIR"), owned("AGENT_ARTIFACTS_DIR")
    runtime = runtime.resolve(strict=True)
    receipt = json.loads((runtime / "visual-runtime.json").read_text())
    if receipt["node"] != NODE or receipt["image"] != IMAGE or receipt["chromium_revision"] != 1194 or receipt["node_archive_sha256"] != NODE_SHA256 or receipt["playwright"] != "1.56.1":
        raise SystemExit("Runtime pin mismatch")
    if set(receipt["locks"]) != {"package-lock.json", "web/package-lock.json", "e2e/package-lock.json"}:
        raise SystemExit("Runtime lock inventory mismatch")
    for file, digest in receipt["locks"].items():
        if hashlib.sha256((KITH / file).read_bytes()).hexdigest() != digest:
            raise SystemExit("Runtime lock mismatch: " + file)
    baseline = KITH / "e2e/visual-baselines"
    if mode == "candidate":
        if not candidate or not candidate.is_absolute() or not candidate.is_relative_to(artifacts) or candidate.exists() or not candidate.parent.resolve().is_relative_to(artifacts.resolve()):
            raise SystemExit("Candidate mode requires a new absolute directory beneath AGENT_ARTIFACTS_DIR")
        candidate.mkdir(parents=True)
        baseline = candidate
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in baseline.glob("*.png")}
    scratch = build / "wrangler"
    scratch.mkdir(exist_ok=True)
    links = [(KITH / "node_modules", runtime / "build/root/node_modules", runtime), (KITH / "web/node_modules", runtime / "build/web/node_modules", runtime),
             (KITH / "e2e/node_modules", runtime / "build/e2e/node_modules", runtime), (KITH / ".wrangler", scratch, task)]
    created = []
    # Same-runtime concurrent runs must not remove each other's transient source links.
    lock_path = runtime / "build" / "visual-source.lock"
    lock = lock_path.open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise SystemExit("Another visual job owns this source/runtime")
    try:
        for link, target, owner in links:
            if not target.is_dir() or target.is_symlink() or not target.resolve().is_relative_to(owner):
                raise SystemExit("Invalid owned runtime path: " + str(target))
            if os.path.lexists(link):
                if not link.is_symlink() or link.resolve() != target.resolve():
                    raise SystemExit("Refusing existing state: " + str(link))
            else:
                link.symlink_to(target, target_is_directory=True)
                created.append((link, target))
        git_common = Path(subprocess.check_output(["git", "-C", str(REPO), "rev-parse", "--path-format=absolute", "--git-common-dir"], text=True).strip())
        args = ["docker", "run", "--rm", "--init", "--network", "none", "--read-only", "--user", f"{os.getuid()}:{os.getgid()}", "--tmpfs", "/tmp:rw,size=64m", "--shm-size", "512m", "-w", str(KITH)]
        for path, readonly in [(REPO, True), (runtime, False), (task, False)]:
            args += ["--mount", f"type=bind,src={path},dst={path}" + (",readonly" if readonly else "")]
        if not git_common.is_relative_to(REPO):
            args += ["--mount", f"type=bind,src={git_common},dst={git_common},readonly"]
        env = {"PATH": str(runtime / ("build/node-v" + NODE + "-linux-x64/bin")) + ":/usr/local/bin:/usr/bin:/bin",
               "PLAYWRIGHT_BROWSERS_PATH": str(runtime / "cache/playwright"), "WRANGLER_SEND_METRICS": "false", "CLOUDFLARE_CF_FETCH_ENABLED": "false",
               "XDG_CONFIG_HOME": str(build / "disposable-config"), "WRANGLER_LOG_PATH": str(evidence / "wrangler.log"),
               "KITH_E2E_WEB_DIST_DIR": str(build / "web-dist"), "KITH_E2E_ARTIFACTS_ROOT": str(evidence / "runs"),
               "KITH_VISUAL_BASELINE_DIR": str(baseline), "KITH_E2E_LOOPBACK_ONLINE": "1"}
        for name in ["TMPDIR", "TMP", "TEMP", "NODE_COMPILE_CACHE", "npm_config_cache", "NPM_CONFIG_CACHE"]:
            if name in os.environ:
                env[name] = os.environ[name]
        if mode == "probe":
            env["KITH_VISUAL_PROBE"] = "1"
        for key, value in env.items():
            args += ["-e", key + "=" + value]
        args += [IMAGE]
        if mode == "suite" and focus:
            patterns = {"evidence": "E2E-W0-03", "network": "E2E-W0-04", "harness": "@W0", "chat": "@W1|@W3|E2E-W2-06"}
            args += ["node", "e2e/node_modules/playwright/cli.js", "test", "-c", "e2e/playwright.config.ts", "--grep", patterns[focus]]
        elif mode == "suite":
            args += ["npm", "run", "e2e:all"]
        else:
            args += ["node", "e2e/node_modules/playwright/cli.js", "test", "-c", "e2e/visual.playwright.config.ts"]
        if mode == "candidate":
            args.append("--update-snapshots")
        (evidence / "visual-command.json").write_text(json.dumps(args, indent=2) + "\n")
        with (evidence / "visual.log").open("x") as log:
            result = subprocess.run(args, stdout=log, stderr=subprocess.STDOUT)
        print((evidence / "visual.log").read_text()[-6000:])
        after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in baseline.glob("*.png")}
        if mode != "candidate" and before != after:
            raise SystemExit("Baseline changed during gate")
        (evidence / "baseline-hashes.json").write_text(json.dumps(after, indent=2) + "\n")
        return result.returncode
    finally:
        for link, target in reversed(created):
            if link.is_symlink() and link.resolve() == target.resolve():
                link.unlink()
        lock.close()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("mode", choices=["provision", "check", "probe", "candidate", "suite"])
parser.add_argument("--runtime", type=Path, help="absolute launcher task directory containing visual-runtime.json")
parser.add_argument("--candidate-dir", type=Path)
parser.add_argument("--focus", choices=["evidence", "network", "harness", "chat"], help="bounded focused validation, suite mode only")
options = parser.parse_args()
if options.focus and options.mode != "suite":
    parser.error("--focus is only valid with suite")
task = owned("AGENT_WORKSPACE_TASK_DIR")
if options.mode == "provision":
    provision(task)
else:
    if not options.runtime or not options.runtime.is_absolute():
        parser.error("--runtime must be absolute")
    sys.exit(gate(task, options.runtime, options.mode, options.candidate_dir, options.focus))
