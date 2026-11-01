#!/usr/bin/python3
"""Synthetic PTY peer. No provider client, credentials, or external networking."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import tty

root = Path(__file__).resolve().parent
args = sys.argv[1:]
scenario = (root / "scenario").read_text()


def record(name, value):
    with (root / name).open("a") as out:
        out.write(json.dumps(value) + "\n")


def flag(name):
    return args[args.index(name) + 1] if name in args else None


def wait_for(name):
    deadline = time.monotonic() + 15
    while not (root / name).exists():
        if time.monotonic() >= deadline:
            raise RuntimeError("synthetic gate timed out")
        time.sleep(0.005)


interactive = os.isatty(0) and os.isatty(1)
record("starts.jsonl", {"pid": os.getpid(), "pgid": os.getpgrp(),
                       "interactive": interactive, "args": args,
                       "loader_clean": all("INHERITED_CANARY" not in os.environ.get(k, "")
                                           for k in ("BUN_OPTIONS", "NODE_OPTIONS", "LD_PRELOAD")),
                       "entrypoint_clean": "CLAUDE_CODE_ENTRYPOINT" not in os.environ})
if not interactive:
    # Deliberately supports only explicit print compatibility, not TUI fallback.
    assert scenario == "print" and "-p" in args
    for line in sys.stdin:
        print(json.dumps({"type": "system", "subtype": "init", "session_id": "fake-print"}), flush=True)
        for event in [
            {"type": "message_start", "message": {"id": "print-1", "type": "message", "role": "assistant", "content": [], "usage": {"input_tokens": 2}}},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "explicit-print"}},
            {"type": "content_block_stop", "index": 0},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 7}},
            {"type": "message_stop"},
        ]:
            print(json.dumps({"type": "stream_event", "event": event}), flush=True)
        print(json.dumps({"type": "result", "subtype": "success", "is_error": False}), flush=True)
    sys.exit(0)

assert not any(x in args for x in ("-p", "--print", "--output-format", "--input-format", "--dangerously-skip-permissions"))
assert flag("--model") == "claude-opus-5-5"
assert flag("--permission-mode") == "default"
assert "--strict-mcp-config" in args
assert "--preload" in os.environ.get("BUN_OPTIONS", "")
sid = flag("--session-id") or flag("--resume")
assert sid, "helper must select exact session"
project = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "projects" / re.sub(r"[^A-Za-z0-9]", "-", os.getcwd())
project.mkdir(parents=True, exist_ok=True)
transcript = project / (sid + ".jsonl")
if flag("--resume"):
    assert transcript.exists(), "resume must reference retained owned transcript"


def row(value):
    with transcript.open("a") as out:
        out.write(json.dumps({"sessionId": sid, **value}) + "\n")


tap_path = Path(os.environ["THINROUTER_CLAUDE_TAP"])
record("private.jsonl", {"helper_pid": os.getppid(), "tap_dir": str(tap_path.parent),
                         "dir_mode": tap_path.parent.stat().st_mode & 0o777,
                         "tap_mode": tap_path.stat().st_mode & 0o777})
if scenario == "grace":
    def graceful_exit(signum, frame):
        time.sleep(0.8)
        (root / "graceful-cleanup").touch()
        sys.exit(0)
    signal.signal(signal.SIGTERM, graceful_exit)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
if scenario in ("cancel", "hardkill"):
    # A real owned descendant, deliberately unaffected by polite termination.
    # The transport's group cleanup must catch it even after the PTY leader dies.
    descendant = os.fork()
    if descendant == 0:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        record("descendants.jsonl", {"pid": os.getpid(), "pgid": os.getpgrp()})
        while True:
            signal.pause()
    deadline = time.monotonic() + 3
    while not (root / "descendants.jsonl").exists():
        if time.monotonic() > deadline:
            raise RuntimeError("synthetic descendant witness absent")
        time.sleep(0.005)


def tap(value):
    # A JSONL record is intentionally split across writes to exercise buffering.
    encoded = (json.dumps(value) + "\n").encode()
    with tap_path.open("ab", buffering=0) as out:
        mid = len(encoded) // 2
        out.write(encoded[:mid])
        out.write(encoded[mid:])


if scenario != "missing":
    tap({"tap": "on"})
tty.setraw(0)
os.write(1, "❯ ".encode())
stream_number = 0
helper = None


def rpc(number, method, params=None):
    request = {"jsonrpc": "2.0", "id": number, "method": method}
    if params is not None:
        request["params"] = params
    helper.stdin.write(json.dumps(request) + "\n")
    helper.stdin.flush()
    while True:
        line = helper.stdout.readline()
        if not line:
            raise RuntimeError("synthetic MCP helper ended")
        response = json.loads(line)
        if response.get("id") == number:
            return response


def message(text, tool=False, gate=False):
    global stream_number
    stream_number += 1
    n = stream_number
    mid = "fake-message-%d" % n

    def event(value):
        tap({"s": n, "e": value})

    tap({"s": n, "open": True})
    usage = {"input_tokens": 2, "cache_creation_input_tokens": 3,
             "cache_read_input_tokens": 5, "output_tokens": 0}
    event({"type": "message_start", "message": {"id": mid, "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [], "usage": usage}})
    if tool:
        block = {"type": "tool_use", "id": "toolu_tui", "name": "mcp__thinrouter__get_weather", "input": {}}
        event({"type": "content_block_start", "index": 0, "content_block": block})
        event({"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": '{"city":"Taipei"}'}})
        block["input"] = {"city": "Taipei"}
    else:
        block = {"type": "text", "text": text}
        event({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
        event({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}})
    if gate:
        (root / "delta-written").touch()
        wait_for("release")
    if scenario == "cut":
        tap({"s": n, "end": "cut"})
        sys.exit(0)
    event({"type": "content_block_stop", "index": 0})
    event({"type": "message_delta", "delta": {"stop_reason": "tool_use" if tool else "end_turn"}, "usage": {"output_tokens": 7}})
    event({"type": "message_stop"})
    tap({"s": n, "end": "done"})
    row({"type": "assistant", "message": {"id": mid, "role": "assistant", "content": [block], "usage": {**usage, "output_tokens": 7}, "stop_reason": "tool_use" if tool else "end_turn"}})
    (root / "assistant-written").touch()


buf = b""
pasted = None
turn = 0
while True:
    part = os.read(0, 4096)
    if not part:
        break
    buf += part
    if pasted is None and b"\x1b[201~" in buf:
        start = buf.index(b"\x1b[200~") + len(b"\x1b[200~")
        end = buf.index(b"\x1b[201~")
        pasted = buf[start:end].decode()
        buf = buf[end + len(b"\x1b[201~"):]
        os.write(1, ("[Pasted text] " + pasted[-160:]).encode())
    if pasted is None or b"\r" not in buf:
        continue
    buf = buf[buf.index(b"\r") + 1:]
    turn += 1
    row({"type": "user", "message": {"role": "user", "content": pasted}})
    record("turns.jsonl", {"turn": turn, "pid": os.getpid()})
    pasted = None
    if scenario == "delayedtap":
        row({"type": "system", "subtype": "turn_duration", "durationMs": 1})
        time.sleep(0.2)
    if scenario == "unobserved":
        row({"type": "system", "subtype": "turn_duration", "durationMs": 1})
        os.write(1, "❯ ".encode())
        continue
    if scenario == "missing":
        row({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "MUST_NOT_BECOME_SUCCESS"}]}})
        os.write(1, b"PRIVATE_TERMINAL_CANARY")
        sys.exit(0)
    if scenario == "tool" and helper is None:
        cfg = json.loads(Path(flag("--mcp-config")).read_text())["mcpServers"]["thinrouter"]
        helper = subprocess.Popen([cfg["command"]] + cfg["args"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        record("helpers.jsonl", {"pid": helper.pid})
        rpc(1, "initialize", {"protocolVersion": "2025-06-18"})
        helper.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        helper.stdin.flush()
        rpc(2, "tools/list")
        message("", tool=True)
        result = rpc(3, "tools/call", {"name": "get_weather", "arguments": {"city": "Taipei"}})
        record("mcp-result.jsonl", result)
        message("Result: " + result["result"]["content"][0]["text"])
    else:
        message("early-tui" if scenario in ("gated", "cancel", "cut", "hardkill", "grace") else "turn-%d" % turn,
                gate=scenario in ("gated", "cancel", "hardkill", "grace"))
    row({"type": "system", "subtype": "turn_duration", "durationMs": 1})
    os.write(1, "❯ ".encode())
