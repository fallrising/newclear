#!/usr/bin/env python3
"""Run only the pinned focused fixture-startup executable; retain safe evidence.

The outer retained launcher must pin this file, the checker, Python and manifest
before invocation. This runner neither configures providers nor reads real HOME.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import tempfile
import threading
import time

import fixture_startup_check as check


def kill_owned_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


@contextmanager
def interrupt_signals():
    """Temporarily route SIGTERM through Python's owned-resource cleanup."""
    check.require(threading.current_thread() is threading.main_thread(),
                  "signal_context_requires_main_thread")
    previous = signal.getsignal(signal.SIGTERM)
    interrupted = False

    def terminate(_number, _frame):
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            raise KeyboardInterrupt
        # A repeated SIGTERM must not interrupt the first signal's cleanup.

    signal.signal(signal.SIGTERM, terminate)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


def execute(binary, arguments, environment, inventory=False):
    """Drain both pipes in bounded chunks, including after output overflows."""
    started = time.monotonic()
    collector = check.EvidenceStream()
    raw_inventory = bytearray()
    inv_hash = hashlib.sha256()
    inv_bytes = 0
    inv_bad = False
    timed_out = False
    process = subprocess.Popen([str(binary), *arguments], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=environment, cwd=environment["HOME"],
                               start_new_session=True)
    selection = None
    try:
        selection = selectors.DefaultSelector()
        for stream, name in ((process.stdout, "stdout"), (process.stderr, "stderr")):
            os.set_blocking(stream.fileno(), False)
            selection.register(stream, selectors.EVENT_READ, name)
        deadline = started + check.MAX_SECONDS
        kill_deadline = None
        while selection.get_map():
            now = time.monotonic()
            if now >= deadline and not timed_out:
                timed_out = True
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                kill_deadline = now + 1
            if kill_deadline is not None and now >= kill_deadline:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                kill_deadline = None
            if timed_out and now > deadline + 3:
                break
            for key, _ in selection.select(0.05):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if not chunk:
                    selection.unregister(key.fileobj)
                    continue
                if inventory:
                    inv_bytes += len(chunk)
                    inv_hash.update(chunk)
                    inv_bad |= key.data != "stdout" or inv_bytes > check.MAX_OUTPUT
                    if not inv_bad:
                        raw_inventory.extend(chunk)
                else:
                    collector.feed(key.data, chunk)
        if process.poll() is None:
            remaining = max(0.001, deadline-time.monotonic()) if not timed_out else 1
            try:
                process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=2)
        else:
            process.wait()
    finally:
        # The leader may have exited while its descendants still own the pipes.
        # Cleanup therefore targets this invocation's new group unconditionally,
        # including constructor/read/select/interrupt exceptions, before temp removal.
        try:
            kill_owned_group(process)
        finally:
            try:
                process.wait(timeout=2)
            finally:
                if selection is not None:
                    selection.close()
                process.stdout.close()
                process.stderr.close()
    if inventory:
        names = []
        try:
            check.require(not inv_bad, "inventory_output")
            names = sorted(check.parse_inventory(bytes(raw_inventory)))
        except check.CheckFailure:
            inv_bad = True
        raw_inventory.clear()
        output = dict(bytes=inv_bytes, sha256=inv_hash.hexdigest(), overflow=inv_bad, names=names)
    else:
        output = collector.result()
    return dict(exit_code=process.returncode, timed_out=timed_out,
                elapsed_ms=int((time.monotonic()-started)*1000), owned_process_reaped=True,
                descendant_cleanup=None, output=output)


def environment(home, manifest):
    return {"PATH": "/usr/bin:/bin", "HOME": str(home), "TMPDIR": str(home),
            "CLAUDE_CONFIG_DIR": str(home/"claude"), "CURSOR_CONFIG_DIR": str(home/"cursor"),
            "RUST_LOG": "thinrouter::server=info", "NO_COLOR": "1", "TERM": "dumb",
            "THINROUTER_TEST_BINARY": manifest["normal_binary"]["path"],
            "THINROUTER_TEST_BINARY_SHA256": manifest["normal_binary"]["sha256"]}


def _run(manifest):
    probes = check.verify_manifest(manifest)
    report = dict(schema_version=1, status="failed", historical_root_cause="unknown",
                  whole_round_metrics=None, live_client_version_provider_verified=False,
                  owner_personal_run_claimed=False, fingerprints=check.fingerprints(manifest),
                  source_provenance=manifest["source_provenance"], listening_probes=probes,
                  isolation=check.ISOLATION.copy(), inventory=None, native=None,
                  temporary_state_removed=None, failure_code=None)
    home = None
    try:
        with tempfile.TemporaryDirectory(prefix="fixture-startup-") as directory:
            home = Path(directory)
            env = environment(home, manifest)
            native = manifest["native_binary"]["path"]
            report["inventory"] = execute(native, ["--list"], env, inventory=True)
            inv = report["inventory"]
            check.require(inv["exit_code"] == 0 and not inv["timed_out"] and not inv["output"]["overflow"]
                          and inv["output"]["names"] == list(check.NAMES)
                          and inv["output"]["sha256"] == manifest["inventory_sha256"], "inventory_gate_failed")
            # Recheck immediately before executing tests; a mutable shared target is never used.
            check.verify_manifest(manifest)
            report["native"] = execute(native, ["--nocapture", "--test-threads=1"], env)
        report["temporary_state_removed"] = not home.exists()
        report["status"] = "passed"
        check.validate_report(report, manifest, probes)
    except check.CheckFailure as error:
        report["status"] = "failed"
        report["failure_code"] = str(error)
    except KeyboardInterrupt:
        report["status"] = "failed"
        report["failure_code"] = "interrupted"
    except Exception:
        report["status"] = "failed"
        report["failure_code"] = "execution_failed"
    finally:
        if home is not None:
            report["temporary_state_removed"] = not home.exists()
    return report


def run(manifest):
    """Public main-thread entry, with signal handlers restored for import callers."""
    with interrupt_signals():
        return _run(manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    try:
        check.require(args.manifest.stat().st_size <= check.MAX_OUTPUT, "manifest_size")
        manifest = check.loads(args.manifest.read_bytes())
        args.output_dir.mkdir(parents=True, exist_ok=True)
        target = args.output_dir/"report.json"
        check.require(not target.exists(), "report_already_exists")
        report = run(manifest)
        with target.open("x", encoding="utf-8") as output:
            json.dump(report, output, indent=2, sort_keys=True, allow_nan=False)
            output.write("\n")
        print("fixture startup check: " + report["status"])
        return 0 if report["status"] == "passed" else 1
    except (Exception, KeyboardInterrupt):
        print("fixture startup check: failed (preflight)")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
