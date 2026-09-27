"""Fixed workspace operations executed as the unprivileged guest account only."""

import hashlib
import json
import os
import selectors
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path("/home/agentprobe/workspace")
LIMIT = 256 * 1024
CHECK_OUTPUT_LIMIT = 1024 * 1024


def git(*args):
    return subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=always", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        timeout=30,
    ).stdout


def patch_bytes(base_sha):
    # Include untracked files without staging their content or making a commit.
    git("add", "--intent-to-add", "--", ".")
    patch = git("diff", "--no-ext-diff", "--no-textconv", "--binary", base_sha, "--")
    if len(patch) > LIMIT:
        raise RuntimeError("diff_limit_exceeded")
    return patch


def check_command(check, run_id, base_sha):
    started = time.monotonic()
    digest = hashlib.sha256()
    output_bytes = 0
    process = None
    status, exit_code = "unknown", None
    reason = "check_start_failed"
    selector = selectors.DefaultSelector()
    try:
        process = subprocess.Popen(
            check["argv"],
            cwd=ROOT,
            env={
                "HOME": "/home/agentprobe",
                "AGENT_BASE_SHA": base_sha,
                "AGENT_RUN_ID": run_id,
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "PYTHONDONTWRITEBYTECODE": "1",
            },
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            close_fds=True,
            start_new_session=True,
            bufsize=0,
        )
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = started + check["timeout_seconds"]
        timed_out = output_limit = False
        while process.poll() is None or selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                break
            if not selector.get_map():
                time.sleep(min(0.05, remaining))
                continue
            events = selector.select(min(0.2, remaining))
            for key, _ in events:
                chunk = os.read(key.fd, min(65536, CHECK_OUTPUT_LIMIT + 1 - output_bytes))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                digest.update(chunk)
                output_bytes += len(chunk)
                if output_bytes > CHECK_OUTPUT_LIMIT:
                    output_limit = True
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    break
            if output_limit:
                break
            if process.poll() is not None and not selector.get_map():
                break
        process.wait(timeout=2)
        group_remaining = False
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            group_remaining = False
        else:
            group_remaining = True
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        exit_code = (
            process.returncode
            if process.returncode is not None and process.returncode >= 0
            else None
        )
        if timed_out:
            reason = "check_timeout"
        elif output_limit:
            reason = "check_output_limit"
        elif group_remaining:
            reason = "check_process_unconfirmed"
        elif process.returncode == 0:
            status, reason = "passed", "check_exit_zero"
        elif process.returncode is not None and process.returncode > 0:
            status, reason, exit_code = "failed", "check_exit_nonzero", process.returncode
        else:
            reason = "check_process_unconfirmed"
    except (OSError, subprocess.SubprocessError):
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
        reason = "check_execution_unconfirmed"
    finally:
        selector.close()
        if process is not None and process.stdout is not None:
            process.stdout.close()
    return {
        "id": check["id"],
        "status": status,
        "exit_code": exit_code if status != "unknown" else None,
        "duration_ms": min(120000, int((time.monotonic() - started) * 1000)),
        "output_bytes": min(output_bytes, CHECK_OUTPUT_LIMIT + 1),
        "output_sha256": digest.hexdigest(),
        "reason": reason,
    }


def contract_sha256(contract):
    raw = json.dumps(contract, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()


def result(request):
    os.chdir(ROOT)
    before = patch_bytes(request["base_sha"])
    contract = request["verification"]
    mode = contract["mode"]
    if mode == "fixture-m2":
        output = Path("m2-result.txt")
        expected = request["run_id"] + "\n"
        verified = (
            output.is_file()
            and not output.is_symlink()
            and output.stat().st_size < 100
            and output.read_text() == expected
        )
        verification = {
            "status": "passed" if verified else "failed",
            "name": "m2_fixture_workspace_assertion",
            "exit_code": 0 if verified else 1,
            "reason": "Fixed fixture assertion only; repository tests not configured.",
        }
        workspace_value = output.read_text() if verified else None
    elif mode == "none":
        verification = {
            "status": "unknown",
            "name": "profile_verification",
            "revision": contract["revision"],
            "contract_sha256": contract_sha256(contract),
            "diff_sha256": hashlib.sha256(before).hexdigest(),
            "checks": [],
            "reason": "verification_not_configured",
        }
        workspace_value = None
    elif mode == "commands":
        checks = [
            check_command(item, request["run_id"], request["base_sha"])
            for item in contract["checks"]
        ]
        after = patch_bytes(request["base_sha"])
        passed = all(item["status"] == "passed" for item in checks)
        unknown = any(item["status"] == "unknown" for item in checks)
        unchanged = before == after
        verification = {
            "status": "passed"
            if passed and unchanged
            else "failed"
            if not unknown and unchanged
            else "unknown",
            "name": "profile_verification",
            "revision": contract["revision"],
            "contract_sha256": contract_sha256(contract),
            "diff_sha256": hashlib.sha256(before).hexdigest(),
            "checks": checks,
            "reason": (
                "checks_passed"
                if passed and unchanged
                else "check_failed"
                if not unknown and unchanged
                else "verification_modified_workspace"
                if not unchanged
                else "check_outcome_unknown"
            ),
        }
        workspace_value = None
    else:
        raise RuntimeError("verification_policy_invalid")
    return {
        "base_sha": request["base_sha"],
        "diff": before.decode("utf-8"),
        "diff_sha256": hashlib.sha256(before).hexdigest(),
        "diff_bytes": len(before),
        "verification": verification,
        "workspace_value": workspace_value,
    }


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
    print(json.dumps(result(request)))


if __name__ == "__main__":
    main()
