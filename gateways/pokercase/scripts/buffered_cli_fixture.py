#!/usr/bin/env python3
"""Owned synthetic buffered CLI; no provider, credential discovery or sockets."""
import json
import fcntl
import hashlib
import re
import subprocess
from urllib.parse import urlsplit
import os
from pathlib import Path
import signal
import sqlite3
import sys
import uuid

TEXT = "Hello from the offline gateway."
TOOL_TEXT = "Tool result: 5."
IMAGE = "sha256:" + "a" * 64
CASE = None
MODELS = frozenset(("complete", "partial", "missing", "zero", "invalid", "incomplete", "unknown", "error", "eof", "cancel_before", "cancel_after", "limit", "retry", "reuse", "resume_retry", "tool"))


def identity(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def witness(root):
    dbpath = root.parent / "thinrouter.db"
    if not dbpath.is_file() or dbpath.is_symlink():
        raise ValueError("fixture_database_not_owned")
    with sqlite3.connect(dbpath.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute("SELECT request_id,attempt_id,public_model,upstream_model,usage_source FROM usage_events WHERE finalized_at IS NULL AND attempt_id IS NOT NULL ORDER BY id").fetchall()
    return [dict(row) for row in rows]


def trace(root, kind, model, **fields):
    pending = witness(root)
    case = CASE or (root / "current-case").read_text()
    selected = [row for row in pending if row["public_model"] == case]
    with (root / "trace.jsonl").open("a+") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        stream.seek(0); sequence = sum(1 for _ in stream) + 1
        record = {"sequence": sequence, "case": case, "kind": kind, "pid": os.getpid(),
                  "birth": identity(os.getpid()), "model": model, "pending_count": len(selected),
                  "pending": selected, "attempt_id": selected[0]["attempt_id"] if len(selected) == 1 else None,
                  "request_id": selected[0]["request_id"] if len(selected) == 1 else None, **fields}
        stream.write(json.dumps(record) + "\n")


def emit(root, provider, model, value):
    encoded = json.dumps(value)
    saved = value if len(encoded) < 65536 else {"event_type": value.get("type"), "large_event_bytes": len(encoded.encode()), "large_event_sha256": hashlib.sha256(encoded.encode()).hexdigest()}
    record = {"case": CASE or (root / "current-case").read_text(), "provider": provider, "model": model, "event": saved}
    with (root / "raw.jsonl").open("a") as f:
        fcntl.flock(f, fcntl.LOCK_EX); f.write(json.dumps(record) + "\n")
    print(json.dumps(value), flush=True)


def run_claude(root, args):
    model = args[args.index("--model") + 1]
    if model not in MODELS: raise ValueError("fixture_model")
    helper = None
    def out(value): emit(root, "claude", model, value)
    def event(value): out({"type": "stream_event", "event": value})
    def cleanup(*_):
        if helper is not None and helper.poll() is None:
            helper.terminate()
            try: helper.wait(timeout=2)
            except subprocess.TimeoutExpired: helper.kill(); helper.wait(timeout=2)
        trace(root, "exit", model); raise SystemExit(0)
    signal.signal(signal.SIGTERM, cleanup); signal.signal(signal.SIGINT, cleanup)
    trace(root, "spawn", model, provider="claude", resumed="--resume" in args)
    project = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "projects" / re.sub(r"[^A-Za-z0-9]", "-", os.getcwd())
    project.mkdir(parents=True, exist_ok=True)
    sid = args[args.index("--resume") + 1] if "--resume" in args else str(uuid.uuid4())
    if "--resume" in args:
        if model == "resume_retry" or not (project / (sid + ".jsonl")).is_file():
            trace(root, "resume_rejected", model); sys.stderr.write("No conversation found\n"); return 1
        trace(root, "resume", model)
    if "--mcp-config" in args:
        config_path = Path(args[args.index("--mcp-config") + 1]).resolve()
        if not config_path.is_relative_to(root.parent): raise ValueError("fixture_helper_config_scope")
        cfg = json.loads(config_path.read_text())["mcpServers"]["thinrouter"]
        if str(Path(cfg["command"]).resolve()) != (root / "expected-binary").read_text(): raise ValueError("fixture_helper_binary")
        helper_args = cfg["args"]
        if helper_args[0] != "claude-mcp-helper": raise ValueError("fixture_helper_command")
        for flag in ["--tools-file", "--callback-file"]:
            path = Path(helper_args[helper_args.index(flag) + 1]).resolve()
            if not path.is_relative_to(root.parent) or path.is_symlink(): raise ValueError("fixture_helper_file")
        callback = json.loads(Path(helper_args[helper_args.index("--callback-file") + 1]).read_text())
        parsed = urlsplit(callback["url"])
        if parsed.scheme != "http" or parsed.netloc != (root / "expected-gateway").read_text() or parsed.path != "/_thinrouter/claude-mcp" or parsed.username or parsed.query or parsed.fragment: raise ValueError("fixture_helper_destination")
        helper = subprocess.Popen([cfg["command"], *helper_args], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        trace(root, "helper", model, helper_pid=helper.pid, helper_birth=identity(helper.pid), callback_origin=parsed.netloc)
        def rpc(identifier, method, params=None):
            trace(root, "helper_rpc", model, method=method)
            request = {"jsonrpc": "2.0", "id": identifier, "method": method}
            if params is not None: request["params"] = params
            helper.stdin.write(json.dumps(request) + "\n"); helper.stdin.flush()
            while True:
                line = helper.stdout.readline()
                if not line: raise ValueError("fixture_helper_eof")
                reply = json.loads(line)
                if reply.get("id") == identifier: return reply
        rpc(1, "initialize", {"protocolVersion": "2025-06-18"})
        helper.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); helper.stdin.flush()
        if not any(t["name"] == "add" for t in rpc(2, "tools/list")["result"]["tools"]): raise ValueError("fixture_tool_list")
    def message(tool=False):
        usage = {"input_tokens": 12, "output_tokens": 0, "cache_read_input_tokens": 3, "cache_creation_input_tokens": 2}
        if model == "partial": usage = {"input_tokens": 12, "output_tokens": 0}
        if model == "missing": usage = {}
        if model == "zero": usage = {key: 0 for key in usage}
        if model == "invalid": usage = {"input_tokens": -1, "output_tokens": 0, "cache_read_input_tokens": 3, "cache_creation_input_tokens": 2}
        event({"type": "message_start", "message": {"id": "synthetic", "type": "message", "role": "assistant", "model": "synthetic", "content": [], "usage": usage}})
        block = {"type": "tool_use", "id": "call_demo_add", "name": "mcp__thinrouter__add", "input": {}} if tool else {"type": "text", "text": ""}
        event({"type": "content_block_start", "index": 0, "content_block": block})
        text = TOOL_TEXT if helper is not None and not tool else TEXT
        delta = {"type": "input_json_delta", "partial_json": json.dumps({"a": 2, "b": 3})} if tool else {"type": "text_delta", "text": text}
        event({"type": "content_block_delta", "index": 0, "delta": delta}); trace(root, "output", model)
        if model == "cancel_after":
            trace(root, "waiting", model)
            while True: signal.pause()
        if model == "limit":
            for _ in range(300): event({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "x" * 65536}})
        if model == "eof": return False
        if model == "error":
            out({"type": "result", "subtype": "error_during_execution", "is_error": True, "result": "synthetic error"}); return False
        event({"type": "content_block_stop", "index": 0})
        stop = "tool_use" if tool else "max_tokens" if model == "incomplete" else "synthetic_unknown" if model == "unknown" else "end_turn"
        output = {} if model == "missing" else {"output_tokens": 0 if model == "zero" else 5}
        event({"type": "message_delta", "delta": {"stop_reason": stop}, "usage": output}); event({"type": "message_stop"})
        trace(root, "terminal", model); return True
    for number, line in enumerate(sys.stdin, 1):
        json.loads(line); trace(root, "user_input", model, provider="claude", number=number)
        with (project / (sid + ".jsonl")).open("a") as f: f.write(line)
        if model == "cancel_before":
            trace(root, "waiting", model)
            while True: signal.pause()
        out({"type": "system", "subtype": "init", "session_id": sid})
        if model == "retry":
            out({"type": "result", "subtype": "error_during_execution", "is_error": True, "result": "usage limit reached"}); break
        if not message(helper is not None): break
        if helper is not None:
            reply = rpc(10 + number, "tools/call", {"name": "add", "arguments": {"a": 2, "b": 3}})
            if reply["result"].get("isError") or reply["result"]["content"][0]["text"] != "5": raise ValueError("fixture_tool_result")
            trace(root, "tool_dispatch", model, provider="claude")
            message(False)
        out({"type": "result", "subtype": "success", "is_error": False, "usage": {"input_tokens": 9000, "output_tokens": 8000}, "result": "ignored session aggregate"})
    cleanup()


RUNTIME_HOST = "--host=unix:///var/run/docker.sock"

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



def run_runtime(root, args):
    if len(args) == 4 and args[:3] == [RUNTIME_HOST, "rm", "-f"] and re.fullmatch(r"thinrouter-cursor-[0-9a-f-]{36}", args[3]):
        trace(root, "runtime_cleanup", "cleanup"); return 0
    command, model = runtime_command(root, args)
    trace(root, "spawn", model, provider="cursor")
    os.execve(command[0], command, {"PATH": "/usr/bin:/bin", "HOME": str(root)})


def run_cursor(root, args):
    model = args[args.index("--model") + 1]
    if model not in MODELS: raise ValueError("fixture_model")
    def out(value): emit(root, "cursor", model, value)
    def text(value, stamp=2): out({"type": "assistant", "timestamp_ms": stamp, "message": {"role": "assistant", "content": [{"type": "text", "text": value}]}})
    def cleanup(*_): trace(root, "exit", model); raise SystemExit(0)
    signal.signal(signal.SIGTERM, cleanup); signal.signal(signal.SIGINT, cleanup)
    trace(root, "cursor_start", model, provider="cursor")
    if model == "retry": sys.stderr.write("usage limit reached\n"); return 1
    if model == "cancel_before":
        trace(root, "waiting", model)
        while True: signal.pause()
    out({"type": "system", "subtype": "init", "session_id": "synthetic-not-persisted", "model": "synthetic"})
    text(TEXT); trace(root, "output", model)
    if model == "cancel_after":
        trace(root, "waiting", model)
        while True: signal.pause()
    if model == "limit":
        for n in range(300): text("x" * 65536, n + 3)
    if model == "eof": return 0
    usage = {"inputTokens": 9359, "outputTokens": 33, "cacheReadTokens": 3328, "cacheWriteTokens": 0}
    if model == "partial": usage = {"outputTokens": 7}
    if model == "zero": usage = {key: 0 for key in usage}
    if model == "invalid": usage = {"inputTokens": -1, "outputTokens": 7, "cacheReadTokens": "bad", "cacheWriteTokens": 1.5}
    result = {"type": "result", "subtype": "error" if model == "error" else "success", "is_error": model == "error", "result": "synthetic error" if model == "error" else TEXT, "duration_ms": 999999}
    if model != "missing": result["usage"] = usage
    out(result); out({"type": "result", "subtype": "success", "is_error": False, "result": "ignored", "usage": {"inputTokens": 9000, "outputTokens": 8000}})
    trace(root, "terminal", model); return 0


def main():
    global CASE
    root = Path(__file__).resolve().parent
    CASE = (root / "current-case").read_text()
    try:
        return (run_runtime if Path(__file__).name == "runtime" else run_cursor if Path(__file__).name == "cursor-agent" else run_claude)(root, sys.argv[1:])
    except (ValueError, IndexError, OSError, sqlite3.Error):
        sys.stderr.write("fixture_rejected\n")
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
