#!/usr/bin/env python3
"""Inert opt-in CLI probe. This is not runtime isolation or FN acceptance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

VERSION = "2.1.312 (Claude Code)"
MODEL = "claude-opus-5-5"
TOOL = "mcp__fanz_probe__probe"


def serve(nonce):
    """Fixed trusted stdio server; no input chooses files, commands or hosts."""
    for line in sys.stdin:
        req = json.loads(line)
        if "id" not in req:
            continue
        method, params = req.get("method"), req.get("params", {})
        if method == "initialize":
            result = {"protocolVersion": params["protocolVersion"], "capabilities": {"tools": {}},
                      "serverInfo": {"name": "fanz-inert-probe", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [{"name": "probe", "description": "Return a public nonce; no external effects.",
                       "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}}]}
        elif method == "tools/call" and params.get("name") == "probe" and params.get("arguments", {}) == {}:
            result = {"content": [{"type": "text", "text": nonce}], "isError": False}
        elif method == "ping":
            result = {}
        else:
            print(json.dumps({"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "unsupported"}}), flush=True)
            continue
        print(json.dumps({"jsonrpc": "2.0", "id": req["id"], "result": result}), flush=True)


def assess(events, nonce, code):
    init = [e for e in events if e.get("type") == "system" and e.get("subtype") == "init"]
    final = [e for e in events if e.get("type") == "result"]
    uses, results = [], []
    for event in events:
        content = event.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if event.get("type") == "assistant" and item.get("type") == "tool_use":
                uses.append(item)
            if event.get("type") == "user" and item.get("type") == "tool_result":
                results.append(item)
    calls = [u for u in uses if u.get("name") == TOOL and u.get("input") == {}]
    matches = [r for r in results if len(calls) == 1 and r.get("tool_use_id") == calls[0].get("id")
               and not r.get("is_error", False) and nonce in json.dumps(r.get("content"))]
    checks = {
        "single_init": len(init) == 1,
        "only_allowed_tools": len(init) == 1 and TOOL in init[0].get("tools", [])
            and set(init[0].get("tools", [])) <= {TOOL, "EndConversation"},
        "mcp_connected": len(init) == 1 and any(s.get("name") == "fanz_probe" and s.get("status") == "connected" for s in init[0].get("mcp_servers", [])),
        "expected_model": len(init) == 1 and init[0].get("model") == MODEL,
        "single_probe_call": len(calls) == 1 and sum(u.get("name") == TOOL for u in uses) == 1 and all(u.get("name") in {TOOL, "EndConversation"} for u in uses),
        "matching_tool_result": len(matches) == 1,
        "successful_result": len(final) == 1 and final[0].get("subtype") == "success" and final[0].get("is_error") is False,
        "no_permission_denials": len(final) == 1 and final[0].get("permission_denials") == [],
        "exit_zero": code == 0,
    }
    return {"status": "PASS_CAPABILITY_ONLY" if all(checks.values()) else "FAIL_CAPABILITY",
            "checks": checks, "tool_call_count": len(calls), "FN_acceptance": "NOT_RUN",
            "isolation_acceptance": "NOT_RUN", "live_coding_submissions": 0}


def run(output, binary):
    output = Path(output).absolute()
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    binary = Path(binary).resolve(strict=True)
    receipt = {"status": "BLOCKED", "FN_acceptance": "NOT_RUN", "live_coding_submissions": 0,
               "cli_invocations": 0, "provider_requests": None, "actual_cost": None}
    def save():
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    save()
    version = subprocess.run([str(binary), "--version"], capture_output=True, text=True, timeout=10)
    if version.returncode or version.stdout.strip() != VERSION:
        receipt["reason"] = "cli_version_mismatch"; save(); return 2
    if any(os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
                                      "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY")):
        receipt["reason"] = "non_subscription_route_environment"; save(); return 2
    auth = subprocess.run([str(binary), "auth", "status"], capture_output=True, text=True, timeout=15)
    try:
        state = json.loads(auth.stdout)
    except ValueError:
        state = {}
    if auth.returncode or state.get("loggedIn") is not True or state.get("authMethod") != "claude.ai" or state.get("apiProvider") != "firstParty":
        receipt["reason"] = "subscription_auth_not_ready"; save(); return 2
    nonce, script = "fanz-capability-" + uuid.uuid4().hex, Path(__file__).resolve()
    config = output / "mcp.json"
    config.write_text(json.dumps({"mcpServers": {"fanz_probe": {"type": "stdio", "command": sys.executable,
                            "args": [str(script), "--serve", nonce]}}}))
    settings = {"disableAllHooks": True, "disableClaudeAiMcpServers": True, "autoMemoryEnabled": False}
    args = [str(binary), "-p", "--model", MODEL, "--effort", "low", "--restricted",
            "--tools", "", "--allowedTools", TOOL, "--strict-mcp-config", "--mcp-config", str(config),
            "--settings", json.dumps(settings), "--disable-slash-commands", "--permission-mode", "dontAsk",
            "--no-session-persistence", "--output-format", "stream-json", "--verbose",
            "--system-prompt", "Call the supplied probe tool once with empty arguments, then say done. Do not use other tools."]
    receipt.update({"cli_version": VERSION, "model": MODEL, "effort": "low",
                    "cli_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
                    "probe_sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
                    "auth": {k: state.get(k) for k in ("loggedIn", "authMethod", "apiProvider", "subscriptionType")},
                    "argv": args, "cli_invocations": 1})
    save()
    started = time.monotonic()
    with (output / "events.jsonl").open("w") as stdout, (output / "stderr.txt").open("w") as stderr:
        proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                                text=True, cwd=output, start_new_session=True)
        try:
            proc.communicate("Call the probe tool once now, then finish.\n", timeout=120)
            code = proc.returncode
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL); proc.wait()
            code = 124
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    try:
        events = [json.loads(line) for line in (output / "events.jsonl").read_text().splitlines() if line.strip()]
        receipt.update(assess(events, nonce, code))
    except (ValueError, TypeError, KeyError):
        receipt.update({"status": "FAIL_CAPABILITY", "reason": "invalid_stream"})
    receipt.update({"exit_code": code, "elapsed_seconds": round(time.monotonic() - started, 3)})
    save()
    for p in output.iterdir():
        p.chmod(0o600)
    print(json.dumps({k: v for k, v in receipt.items() if k in {"status", "checks", "exit_code", "elapsed_seconds", "FN_acceptance"}}))
    return 0 if receipt["status"] == "PASS_CAPABILITY_ONLY" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", help=argparse.SUPPRESS)
    parser.add_argument("--output", help="New private evidence directory")
    parser.add_argument("--claude", help="Absolute path to installed official CLI")
    options = parser.parse_args()
    if options.serve:
        serve(options.serve)
    elif options.output and options.claude:
        raise SystemExit(run(options.output, options.claude))
    else:
        parser.error("--output and --claude required; invokes the existing subscription once")
