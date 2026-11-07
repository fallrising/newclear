#!/usr/bin/python3
import json
import sys
import time
import tomllib
from pathlib import Path

mode = Path(__file__).name
config = tomllib.loads("\n".join(sys.argv[i + 1] for i, v in enumerate(sys.argv) if v == "-c"))
record = Path(config["model_catalog_json"]).parent / "requests.jsonl"
thread = "thread"
turn = "turn"
for line in sys.stdin:
    r = json.loads(line)
    with open(record, "a") as f:
        f.write(json.dumps(r) + "\n")
    method = r.get("method")
    if method == "initialize":
        value = {}
    elif method == "config/read":
        effective = dict(config)
        if mode == "bad-endpoint":
            effective["chatgpt_base_url"] = "https://invalid.example"
        if mode == "bad-notify":
            effective["notify"] = ["must-not-launch"]
        if mode == "bad-feature":
            effective["features"] = {**config["features"], "js_repl": True}
        if mode == "bad-mcp":
            effective["mcp_servers"] = {"unexpected": {"command": "must-not-launch"}}
        value = {"config": effective, "origins": {}, "layers": None}
    elif method == "thread/start":
        value = {
            "model": "wrong" if mode == "wrong-model" else r["params"]["model"],
            "modelProvider": "openai",
            "thread": {"id": thread, "environments": [{}] if mode == "host-env" else []},
        }
    elif method == "mcpServerStatus/list":
        value = {"data": [{}] if mode == "extra-mcp" else [], "nextCursor": None}
    elif method == "turn/start":
        value = {"turn": {"id": turn}}
    elif "result" in r:
        if mode.startswith("review-"):
            print(
                json.dumps(
                    {
                        "method": "item/completed",
                        "params": {
                            "threadId": "other" if mode == "review-wrong-thread" else thread,
                            "turnId": turn,
                            "item": {
                                "type": "agentMessage",
                                "phase": "final_answer",
                                "text": json.dumps(
                                    {
                                        "candidate_sha256": "b" * 64
                                        if mode == "review-wrong-hash"
                                        else "a" * 64,
                                        "verdict": "accept",
                                        "reasons": ["Candidate is correct."],
                                    }
                                ),
                            },
                        },
                    }
                ),
                flush=True,
            )
        print(
            json.dumps(
                {
                    "method": "turn/completed",
                    "params": {
                        "threadId": thread,
                        "turn": {
                            "id": turn,
                            "status": "failed" if mode == "failed-turn" else "completed",
                        },
                    },
                }
            ),
            flush=True,
        )
        continue
    else:
        continue
    print(json.dumps({"id": r["id"], "result": value}), flush=True)
    if method == "turn/start":
        if mode == "hang":
            time.sleep(30)
        elif mode == "no-tools":
            print(
                json.dumps(
                    {
                        "method": "turn/completed",
                        "params": {"threadId": thread, "turn": {"id": turn, "status": "completed"}},
                    }
                ),
                flush=True,
            )
        else:
            print(
                json.dumps(
                    {
                        "id": 42,
                        "method": "item/tool/call",
                        "params": {
                            "threadId": "other" if mode == "wrong-thread" else thread,
                            "turnId": turn,
                            "callId": "unique-call",
                            "tool": "host_exec"
                            if mode == "wrong-tool"
                            else "fanz_write"
                            if mode == "review-write"
                            else "fanz_read",
                            "arguments": {
                                "path": "candidate.json"
                                if mode.startswith("review-")
                                else "totals.py"
                            },
                        },
                    }
                ),
                flush=True,
            )
