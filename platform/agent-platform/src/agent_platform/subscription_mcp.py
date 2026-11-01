"""Trusted stdio bridge: one run, one connector, no CLI-controlled host operations."""

import hashlib
import json
import sys
from pathlib import Path
from uuid import UUID, uuid5

from agent_platform.connector_journal import Journal, private_file
from agent_platform.runtime_client import RuntimeClient

TOOLS = [
    {
        "name": "read",
        "description": "Read a UTF-8 file relative to the isolated repository.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    {
        "name": "write",
        "description": "Write a UTF-8 file relative to the isolated repository.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
            "additionalProperties": False,
        },
    },
    {
        "name": "exec",
        "description": (
            "Execute argv in the isolated repository, maximum60 seconds; no host tools or network."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "argv": {"type": "array", "items": {"type": "string"}, "maxItems": 32},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 60},
            },
            "required": ["argv"],
            "additionalProperties": False,
        },
    },
]


class Bridge:
    def __init__(self, path, client=None):
        self.config = json.loads(private_file(path).read_text())
        self.client = client or RuntimeClient(
            self.config["origin"], private_file(self.config["token_file"]).read_text().strip()
        )
        self.journal = Journal(Path(path).parent / "mcp-journal")

    @property
    def tools(self):
        return TOOLS[:1] if self.config.get("purpose") == "review" else TOOLS

    def call(self, request_id, name, args):
        if self.config.get("purpose") == "review" and (
            name != "read" or args != {"path": "candidate.json"}
        ):
            raise ValueError("review_tool_denied")
        allowed = {
            "read": {"path"},
            "write": {"path", "content"},
            "exec": {"argv", "timeout_seconds"},
        }
        if name not in allowed or not isinstance(args, dict) or set(args) - allowed[name]:
            raise ValueError("invalid_tool")
        if type(request_id) not in (str, int) or len(str(request_id)) > 128:
            raise ValueError("invalid_request_identity")
        config = self.config
        operation = str(uuid5(UUID(config["run_id"]), json.dumps(request_id)))
        payload = {
            **args,
            "action": name,
            "generation": config["generation"],
            "operation_id": operation,
        }
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        with self.journal.locked(config["run_id"]):
            row = self.journal.read(config["run_id"]) or {
                "run_id": config["run_id"],
                "operations": {},
            }
            if any(value.get("state") != "completed" for value in row["operations"].values()):
                row["closed"] = True
                self.journal.write(row)
            if (
                row.get("closed")
                or len(row["operations"]) >= 128
                and operation not in row["operations"]
            ):
                raise ValueError("workspace_admission_closed")
            try:
                return self.journal.operation(
                    row,
                    operation,
                    digest,
                    lambda: self.client.call(
                        "POST", f"/v1/runs/{config['run_id']}/workspace", payload
                    ),
                )
            except Exception:
                # Durable across MCP process restart; no changed ID can reopen admission.
                row["closed"] = True
                self.journal.write(row)
                raise


def serve(path):
    bridge = Bridge(path)
    while line := sys.stdin.buffer.readline(262145):
        if len(line) > 262144:
            return 2
        req = {}
        try:
            req = json.loads(line)
            if "id" not in req:
                continue
            method, params = req.get("method"), req.get("params", {})
            if method == "initialize":
                result = {
                    "protocolVersion": params["protocolVersion"],
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "fanz-workspace", "version": "1"},
                }
            elif method == "tools/list":
                result = {"tools": bridge.tools}
            elif method == "ping":
                result = {}
            elif method == "tools/call":
                name, args = params.get("name"), params.get("arguments", {})
                value = bridge.call(req["id"], name, args)
                result = {
                    "content": [{"type": "text", "text": json.dumps(value)}],
                    "isError": value.get("ok") is not True,
                }
            else:
                raise ValueError("unsupported_method")
            reply = {"jsonrpc": "2.0", "id": req["id"], "result": result}
        except Exception:
            # No secret-bearing exception text or automatic retry of uncertain tools.
            reply = {
                "jsonrpc": "2.0",
                "id": req.get("id") if isinstance(req, dict) else None,
                "error": {
                    "code": -32000,
                    "message": "workspace operation refused or uncertain; do not retry",
                },
            }
        print(json.dumps(reply), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(serve(Path(sys.argv[1])))
