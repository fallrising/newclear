#!/usr/bin/env python3
"""Owned Cursor/runtime stand-in. Executes only its exact sibling fake CLI.

Copied under two names into an isolated temporary directory by the walkthrough.
It has no provider client, Docker invocation, credential discovery or networking.
"""
import json
import os
from pathlib import Path
import signal
import re
import sys

TEXT = "Hello from the offline gateway."
ERROR_CANARY = "synthetic-cursor-private-diagnostic"
IMAGE = "sha256:" + "a" * 64
RUNTIME_HOST = "--host=unix:///var/run/docker.sock"
MODELS = frozenset(("text", "partial", "missing", "invalid", "result_only",
                    "retry", "failure", "bad_result", "cancel", "cancel_before", "stall", "reuse"))


def identity(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def trace(root, kind, **fields):
    # One small append, no arguments/environment/request text/session identifiers.
    record = {"kind": kind, "pid": os.getpid(), "birth": identity(os.getpid()), **fields}
    with (root / "trace.jsonl").open("a") as stream:
        stream.write(json.dumps(record) + "\n")


def runtime_command(root, args):
    """Validate the fixture target and security flags before any executable runs."""
    if not args or args[0] != RUNTIME_HOST:
        raise ValueError("fixture_runtime_host")
    args = args[1:]
    if not args or args[0] != "run":
        raise ValueError("fixture_runtime_command")
    try:
        index = args.index(IMAGE)
        entry = args[args.index("--entrypoint") + 1]
        model = args[index + 1:][args[index + 1:].index("--model") + 1]
    except (ValueError, IndexError):
        raise ValueError("fixture_runtime_shape") from None
    expected = root / "cursor-agent"
    if not expected.is_file() or expected.is_symlink() or entry != str(expected):
        raise ValueError("fixture_runtime_entrypoint")
    if model not in MODELS:
        raise ValueError("fixture_runtime_model")
    if not {"--read-only", "--pull=never"}.issubset(args[:index]):
        raise ValueError("fixture_runtime_security")
    if any("type=bind" in item for item in args[:index]):
        raise ValueError("fixture_runtime_bind")
    for flag, value in (("--user", "1000:1000"), ("--network", "bridge")):
        if not any(args[i:i + 2] == [flag, value] for i in range(index)):
            raise ValueError("fixture_runtime_security")
    cli = args[index + 1:]
    for flag, value in (("--mode", "ask"), ("--sandbox", "disabled"), ("--output-format", "stream-json")):
        if not any(cli[i:i + 2] == [flag, value] for i in range(len(cli))):
            raise ValueError("fixture_cli_security")
    if "--stream-partial-output" not in cli or any(flag in cli for flag in ("--force", "--yolo", "--approve-mcps")):
        raise ValueError("fixture_cli_security")
    return [entry, *cli], model


def runtime(root, args):
    if (len(args) == 4 and args[:3] == [RUNTIME_HOST, "rm", "-f"]
            and re.fullmatch(r"thinrouter-cursor-[0-9a-f-]{36}", args[3])):
        trace(root, "cleanup")
        return 0
    command, model = runtime_command(root, args)
    trace(root, "dispatch", model=model)
    # exec gives the gateway ownership of the actual fake CLI PID, even when hung.
    os.execve(command[0], command, {"PATH": "/usr/bin:/bin", "HOME": str(root)})


def cli(root, args):
    model = args[args.index("--model") + 1]
    if model not in MODELS:
        raise ValueError("fixture_cli_model")
    trace(root, "start", model=model)

    def cleanup(*_):
        trace(root, "exit", model=model)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    def out(value):
        print(json.dumps(value), flush=True)

    def text(value, stamp=None):
        event = {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": value}]}}
        if stamp is not None:
            event["timestamp_ms"] = stamp
        out(event)

    if model in ("retry", "failure"):
        sys.stderr.write(("usage limit reached" if model == "retry" else "not logged in") + " " + ERROR_CANARY + "\n")
        trace(root, "failure", model=model)
        return 1
    if model == "cancel_before":
        trace(root, "waiting", model=model)
        while True:
            signal.pause()
    out({"type": "system", "subtype": "init", "session_id": "synthetic-not-persisted", "model": "synthetic"})
    out({"type": "thinking", "subtype": "delta", "text": "synthetic-not-output", "timestamp_ms": 1})
    if model in ("cancel", "stall"):
        text("partial", 2)
        trace(root, "waiting", model=model)
        while True:
            signal.pause()
    if model != "result_only":
        text(TEXT[:12], 2)
        # Stamped and unstamped aggregate flushes must not duplicate visible output.
        out({"type": "assistant", "timestamp_ms": 3, "model_call_id": "synthetic-flush", "message": {"content": [{"type": "text", "text": TEXT[:12]}]}})
        text(TEXT[12:], 4)
        text(TEXT)
    usage = {"inputTokens": 9359, "outputTokens": 33, "cacheReadTokens": 3328, "cacheWriteTokens": 0}
    if model == "partial":
        usage = {"inputTokens": None, "outputTokens": 7}
    elif model == "invalid":
        usage = {"inputTokens": -1, "outputTokens": 7, "cacheReadTokens": "bad", "cacheWriteTokens": 1.5}
    result = {"type": "result", "subtype": "error" if model == "bad_result" else "success", "is_error": model == "bad_result",
              "result": ERROR_CANARY if model == "bad_result" else TEXT, "duration_ms": 999999,
              "session_id": "synthetic-not-persisted"}
    if model != "missing":
        result["usage"] = usage
    out(result)
    # Deliberately contradictory second terminal must never overwrite the first.
    out({"type": "result", "subtype": "success", "is_error": False, "result": "ignored", "usage": {"inputTokens": 9000, "outputTokens": 8000}})
    trace(root, "terminal", model=model)
    return 0


def main():
    root = Path(__file__).resolve().parent
    try:
        return runtime(root, sys.argv[1:]) if Path(__file__).name == "runtime" else cli(root, sys.argv[1:])
    except (ValueError, IndexError, OSError):
        sys.stderr.write("fixture_rejected\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
