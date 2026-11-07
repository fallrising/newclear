#!/usr/bin/env python3
"""Run and inspect the real Memvid experiment; runtime always denies networking."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

from offline import deny_network, local_environment


ROOT = Path(__file__).resolve().parent
UPSTREAM = "e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813"
SDK_VERSION = "2.0.160"
CORE_VERSION = "2.0.140"


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def source_hashes() -> dict:
    paths = [ROOT / name for name in ("lab.py", "offline.py", "scenarios.py", "models.py", "advanced.py", "requirements.lock", "requirements-models.lock")]
    paths += [ROOT / "native-whisper" / name for name in (
        "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "src/main.rs",
        "prepare_assets.py", "prepare_core.py", "local-cache.patch", "test_token_guard.py")]
    return {str(p.relative_to(ROOT)): digest(p) for p in paths if p.is_file()}


def safe_error(exc: Exception, paths: list[Path]) -> str:
    text = str(exc)
    for p in sorted(paths + [ROOT], key=lambda v: len(str(v)), reverse=True):
        text = text.replace(str(p.resolve()), f"<{p.name}>")
    # Errors belong to the local report. Only known synthetic runs are committed.
    return f"{type(exc).__name__}: {text[:2400]}"


def run_whisper(output: Path, assets: Path, binary: Path) -> dict:
    import os
    import memvid_sdk as sdk

    if not binary.is_file():
        raise FileNotFoundError("Prepare the native Whisper binary before the full profile")
    verifier = subprocess.run(
        [sys.executable, str(ROOT / "native-whisper/prepare_assets.py"), str(assets), "--verify-only"],
        text=True, capture_output=True, timeout=60,
    )
    require(verifier.returncode == 0, "Whisper asset hash verification failed: " + verifier.stderr[-1500:])
    environment = dict(os.environ, HF_HOME=str(assets / "hf-home"))
    process = subprocess.run([str(binary), str(assets / "jfk.flac")], env=environment,
                             text=True, capture_output=True, timeout=180)
    require(process.returncode == 0, "Native Whisper failed: " + process.stderr[-1500:])
    transcription = json.loads(process.stdout)
    require(transcription.get("engine") == "memvid-core::WhisperTranscriber", "Wrong transcription engine")
    require(transcription.get("core_patch") == "local-model-cache-v1", "Unidentified native core patch")
    actual = transcription["text"]
    for keyword in ("americans", "country", "ask"):
        require(keyword in actual.lower(), "Transcription did not contain expected word: " + keyword)
    require(transcription["duration_secs"] > 5, "Audio fixture was not decoded")
    memory = output / "whisper.mv2"
    require(not memory.exists(), "Refusing to overwrite whisper.mv2")
    with sdk.create(str(memory)) as mem:
        frame_id = mem.put("Speech fixture", "transcript", {"source": "OpenAI Whisper public test fixture"},
                           text=actual, uri="mv2://audio/jfk", enable_embedding=False)
        hits = mem.find("country", mode="lex")["hits"]
        require(any(h["uri"] == "mv2://audio/jfk" and "country" in h["text"].lower() for h in hits),
                "Actual transcript was not searchable in Memvid")
        require(not mem.find("qzxnonexistentword", mode="lex")["hits"], "Invented audio result")
        mem.seal()
        verification = mem.verify(deep=True)
        require(verification.get("overall_status") == "passed", "Audio memory failed integrity check")
    with sdk.use("basic", str(memory), read_only=True) as mem:
        require(mem.find("country", mode="lex")["hits"][0]["uri"] == "mv2://audio/jfk", "Transcript persistence failed")
    negative_cases = []
    for label, args, env in (
        ("missing_argument", [str(binary)], environment),
        ("missing_audio", [str(binary), str(output / "missing.flac")], environment),
        ("missing_cache", [str(binary), str(assets / "jfk.flac")], dict(environment, HF_HOME=str(output / "missing-cache"))),
    ):
        result = subprocess.run(args, env=env, text=True, capture_output=True, timeout=30)
        require(result.returncode != 0 and not result.stdout.strip(), f"Native helper accepted {label}")
        negative_cases.append({"case": label, "exit_code": result.returncode})
    token_guards = subprocess.run(
        [sys.executable, str(ROOT / "native-whisper/test_token_guard.py"), str(binary)],
        text=True, capture_output=True, timeout=45,
    )
    require(token_guards.returncode == 0, "Native credential guard failed: " + token_guards.stderr[-1500:])
    negative_cases.extend(json.loads(token_guards.stdout)["cases"])
    return {"transcription": transcription, "frame_id": frame_id, "query": "country",
            "hits": [{k: h.get(k) for k in ("uri", "text", "frame_id")} for h in hits],
            "verification": {"overall_status": verification["overall_status"], "checks": verification["checks"]},
            "reopen_verified": True, "negative_cases": negative_cases,
            "binary_sha256": digest(binary), "audio_sha256": digest(assets / "jfk.flac"),
            "memory": {"path": memory.name, "sha256": digest(memory)},
            "scope": "Native Memvid Whisper with an explicit local-cache initialization patch; real transcript ingested by the Python SDK."}


def run_suite(args, guard: dict, sdk) -> int:
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    from scenarios import CASES

    cases = list(CASES)
    from advanced import run_clip, run_semantic
    cases.extend([
        ("CAP-SEMANTIC", "Local semantic and mixed retrieval", lambda p: run_semantic(p, args.models)),
        ("CAP-CLIP", "Real image/text CLIP retrieval", lambda p: run_clip(p, args.models)),
        ("CAP-WHISPER", "Native Whisper to searchable memory", lambda p: run_whisper(p, args.whisper_assets, args.whisper_bin)),
    ])
    report = {"schema": 1, "started_at": datetime.now(timezone.utc).isoformat(),
              "profile": args.profile, "upstream_reading_commit": UPSTREAM,
              "sdk_version": importlib.metadata.version("memvid-sdk"),
              "runtime": {"python": platform.python_version(), "system": platform.system(), "machine": platform.machine()},
              "native": sdk.info().get("native", {}), "network_guard": guard,
              "source_hashes": source_hashes(), "cases": []}
    for case_id, name, function in cases:
        if args.profile == "core" and case_id in {"CAP-SEMANTIC", "CAP-CLIP", "CAP-WHISPER"}:
            row = {"id": case_id, "name": name, "status": "not_run", "reason": "Not selected by core profile"}
        else:
            started = time.monotonic()
            destination = output / case_id.lower()
            destination.mkdir()
            try:
                observed = function(destination)
                row = {"id": case_id, "name": name, "status": "passed", "observed": observed}
            except Exception as exc:
                row = {"id": case_id, "name": name,
                       "status": "blocked" if isinstance(exc, (FileNotFoundError, ModuleNotFoundError)) else "failed",
                       "error": safe_error(exc, [output, args.models, args.whisper_assets, args.whisper_bin])}
            row["elapsed_seconds"] = round(time.monotonic() - started, 4)
        report["cases"].append(row)
        print(f"{row['status'].upper():8} {case_id}: {name}", flush=True)
        if "error" in row:
            print("  " + row["error"], flush=True)
        report["counts"] = dict(Counter(c["status"] for c in report["cases"]))
        report["full_acceptance_passed"] = len(report["cases"]) == len(cases) and all(c["status"] == "passed" for c in report["cases"])
        (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report["completed_at"] = datetime.now(timezone.utc).isoformat()
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"counts": report["counts"], "full_acceptance_passed": report["full_acceptance_passed"]}))
    return 1 if any(c["status"] in {"failed", "blocked"} for c in report["cases"]) else 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Run content-checked scenarios in a fresh output directory")
    run.add_argument("--profile", choices=("core", "full"), default="full")
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--models", type=Path, default=ROOT / "work/models")
    run.add_argument("--whisper-assets", type=Path, default=ROOT / "work/whisper-assets")
    run.add_argument("--whisper-bin", type=Path, default=ROOT / "work/whisper-build/release/memvid-lab-whisper")
    query = commands.add_parser("query", help="Read a memory file and return lexical source evidence")
    query.add_argument("memory", type=Path)
    query.add_argument("query")
    query.add_argument("--scope")
    query.add_argument("-k", type=int, default=5)
    commands.add_parser("info", help="Print exact SDK/core feature information")
    commands.add_parser("network-check", help="Prove IPv4/IPv6 socket denial")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        local_environment()
        guard = deny_network()
        if args.command == "network-check":
            print(json.dumps(guard, indent=2))
            return 0
        import memvid_sdk as sdk
        require(importlib.metadata.version("memvid-sdk") == SDK_VERSION, "Install the pinned requirements.lock")
        info = sdk.info()
        require(info["native"]["memvid_core_version"] == CORE_VERSION, "Unexpected native core version")
        if args.command == "info":
            print(json.dumps(info, indent=2))
            return 0
        if args.command == "run":
            return run_suite(args, guard, sdk)
        require(1 <= args.k <= 100, "k must be between 1 and 100")
        require(args.memory.is_file(), "Memory file does not exist")
        with sdk.use("basic", str(args.memory), read_only=True) as memory:
            found = memory.find(args.query, mode="lex", scope=args.scope, k=args.k)
        print(json.dumps(found, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        # CLI configuration failures never fabricate a report in an existing run.
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
