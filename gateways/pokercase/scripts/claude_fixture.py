#!/usr/bin/env python3
"""Owned synthetic Claude Code stream-json process; never calls a provider.

The walkthrough copies this file into its temporary directory as its explicit
--claude-bin. Tool phases run only the gateway's configured MCP helper.
"""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import uuid

TEXT = "Hello from the offline gateway."
TOOL_TEXT = "Tool result: 5."
ERROR_CANARY = "synthetic-cli-private-diagnostic"


def identity(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (FileNotFoundError, IndexError):
        return None


def run():
    root = Path(__file__).resolve().parent
    args = sys.argv[1:]
    model = args[args.index("--model") + 1]
    helper = None

    def trace(kind, **fields):
        with (root / "trace.jsonl").open("a") as stream:
            stream.write(json.dumps({"kind": kind, "pid": os.getpid(), "birth": identity(os.getpid()), "model": model, **fields}) + "\n")

    def cleanup(*_):
        if helper is not None and helper.poll() is None:
            helper.terminate()
            try:
                helper.wait(timeout=2)
            except subprocess.TimeoutExpired:
                helper.kill()
                helper.wait(timeout=2)
        trace("exit")
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)
    trace("start", resumed="--resume" in args)
    project = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "projects" / re.sub(r"[^A-Za-z0-9]", "-", os.getcwd())
    project.mkdir(parents=True, exist_ok=True)
    if "--resume" in args:
        sid = args[args.index("--resume") + 1]
        if not (project / (sid + ".jsonl")).is_file():
            sys.stderr.write("No conversation found\n")
            return 1
        trace("resume")
    else:
        sid = str(uuid.uuid4())

    def out(event):
        print(json.dumps(event), flush=True)

    def ev(event):
        out({"type": "stream_event", "event": event})

    def message(mid, blocks, stop, input_tokens, output_tokens, complete=False):
        usage = {"input_tokens": input_tokens, "output_tokens": 0}
        if complete:
            usage.update(cache_read_input_tokens=0, cache_creation_input_tokens=0)
        ev({"type": "message_start", "message": {"id": mid, "type": "message", "role": "assistant", "model": "synthetic-claude", "content": [], "usage": usage}})
        for index, block in enumerate(blocks):
            if block[0] == "text":
                ev({"type": "content_block_start", "index": index, "content_block": {"type": "text", "text": ""}})
                ev({"type": "content_block_delta", "index": index, "delta": {"type": "text_delta", "text": block[1]}})
            else:
                ev({"type": "content_block_start", "index": index, "content_block": {"type": "tool_use", "id": "call_demo_add", "name": "mcp__thinrouter__add", "input": {}}})
                ev({"type": "content_block_delta", "index": index, "delta": {"type": "input_json_delta", "partial_json": json.dumps({"a": 2, "b": 3})}})
            ev({"type": "content_block_stop", "index": index})
        # Two cumulative reports deliberately exercise replacement, not addition.
        ev({"type": "message_delta", "delta": {}, "usage": {"output_tokens": max(0, output_tokens - 1)}})
        ev({"type": "message_delta", "delta": {"stop_reason": stop}, "usage": {"output_tokens": output_tokens}})
        ev({"type": "message_stop"})
        trace("message", input_tokens=input_tokens, output_tokens=output_tokens, stop=stop)

    if "--mcp-config" in args:
        cfg = json.loads(Path(args[args.index("--mcp-config") + 1]).read_text())["mcpServers"]["thinrouter"]
        expected = (root / "expected-binary").read_text()
        if str(Path(cfg["command"]).resolve()) != expected:
            raise RuntimeError("fixture_helper_binary_mismatch")
        helper = subprocess.Popen([cfg["command"], *cfg["args"]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        trace("helper", helper_pid=helper.pid, helper_birth=identity(helper.pid))

        def rpc(identifier, method, params=None):
            request = {"jsonrpc": "2.0", "id": identifier, "method": method}
            if params is not None:
                request["params"] = params
            helper.stdin.write(json.dumps(request) + "\n")
            helper.stdin.flush()
            while True:
                line = helper.stdout.readline()
                if not line:
                    raise RuntimeError("fixture_helper_eof")
                reply = json.loads(line)
                if reply.get("id") == identifier:
                    return reply

        rpc(1, "initialize", {"protocolVersion": "2025-06-18"})
        helper.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        helper.stdin.flush()
        if not any(tool["name"] == "add" for tool in rpc(2, "tools/list")["result"]["tools"]):
            raise RuntimeError("fixture_missing_add")

    out({"type": "system", "subtype": "init", "session_id": sid})
    for number, line in enumerate(sys.stdin, 1):
        json.loads(line)
        trace("input", number=number)
        with (project / (sid + ".jsonl")).open("a") as stream:
            stream.write(line)
        if model in ("retry", "failure"):
            text = "usage limit reached" if model == "retry" else "not logged in"
            out({"type": "result", "subtype": "error_during_execution", "is_error": True, "result": text + " " + ERROR_CANARY})
            trace("failure")
            break
        if model in ("cancel", "stall"):
            ev({"type": "message_start", "message": {"id": "partial", "type": "message", "role": "assistant", "content": [], "usage": {"input_tokens": 4, "output_tokens": 0}}})
            ev({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
            ev({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "partial"}})
            trace("waiting")
            while True:
                signal.pause()
        if helper is None:
            message("text", [("text", TEXT)], "end_turn", 12, 5, model.endswith("complete"))
        else:
            message("tool", [("tool",)], "tool_use", 20, 9)
            reply = rpc(10 + number, "tools/call", {"name": "add", "arguments": {"a": 2, "b": 3}})
            result = reply["result"]
            if result.get("isError") or result["content"][0].get("text") != "5":
                raise RuntimeError("fixture_tool_result")
            trace("tool_result")
            message("tool-result", [("text", TOOL_TEXT)], "end_turn", 21, 6)
        # Deliberate session totals are unsupported; they must never replace phase usage.
        out({"type": "result", "subtype": "success", "is_error": False, "usage": {"input_tokens": 9000, "output_tokens": 8000}, "result": "synthetic ignored aggregate"})
    cleanup()


if __name__ == "__main__":
    raise SystemExit(run())
