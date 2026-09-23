"""Deterministic upstream fixture behind the production HTTP connector, not a VM."""

import hashlib
import secrets
import socket
import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import uvicorn

from agent_platform.connector import Connector, create_connector
from agent_platform.connector_recovery import STOP_KEYS
from agent_platform.runtime_client import RuntimeClient
from agent_platform_m0.contracts import OPENHANDS_SHA, OPENHANDS_VERSION


class Node:
    def __init__(self, root):
        self.config = {"root_dir": str(root)}
        self.rows = {}
        self.calls = {key: 0 for key in ("allocate", "prepare", "prompt", "result", "release")}
        self.partition = False
        self.lose = None
        self.partial_removal = False
        self.swapped = False

    def check(self):
        if self.partition:
            raise TimeoutError("SYNTHETIC_UPSTREAM_SECRET")

    def info(self):
        self.check()
        return {"pools": []}

    def sandboxes(self):
        self.check()
        return [r["claim"] for r in self.rows.values() if r["alive"]]

    def vms(self):
        self.check()
        return [r["observed"] for r in self.rows.values() if r["alive"]]

    def new(self, template, *, net, size, ttl_seconds, claim_ref, deadline):
        self.check()
        self.calls["allocate"] += 1
        identifier = "sandbox-" + claim_ref
        observed = {
            "vm_id": "vm-" + identifier,
            "identity": {"pid": 100, "start_ticks": 123, "state": "S"},
            "image_digest": template.split("@")[1],
            "cpu": 4,
            "memory_bytes": 4 * 1024**3,
            "run_dir": "/fixture/" + identifier,
            "scope": "/fixture/scope/" + identifier,
        }
        self.rows[identifier] = {
            "alive": True,
            "observed": observed,
            "claim": {
                "id": identifier,
                "claim_ref": claim_ref,
                "key": {"template": template, "net": net, "size": size},
            },
        }
        if self.lose == "allocate":
            raise TimeoutError("allocation reply lost")
        return SimpleNamespace(
            id=identifier,
            owner="fixture",
            token="sandbox-canary-secret",
            template_digest=None,
            deadline=(datetime.now(UTC) + timedelta(seconds=ttl_seconds)).isoformat(),
        )

    def observe(self, identifier):
        self.check()
        value = dict(self.rows[identifier]["observed"])
        if self.swapped:
            value["identity"] = {"pid": 100, "start_ticks": 999, "state": "S"}
        return value

    def removal(self, observed):
        self.check()
        alive = next(
            r["alive"] for r in self.rows.values() if r["observed"]["vm_id"] == observed["vm_id"]
        )
        return {key: not alive and not self.partial_removal for key in STOP_KEYS}

    def wait_removed(self, observed):
        return self.removal(observed)

    def attach(self, owner, identifier, token):
        def close():
            self.check()
            self.calls["release"] += 1
            self.rows[identifier]["alive"] = False
            if self.lose == "release":
                raise TimeoutError("release reply lost")

        return SimpleNamespace(close=close)


class FixtureConnector(Connector):
    def isolation(self, row, *, terminal=False):
        # This deterministic fixture has no guest. Real UID proof is KVM-only.
        return {}

    def check_host_reserve(self):
        # No VMs are allocated by this HTTP fixture; CI need not have 8+ GiB free.
        # Real host reserve checks are exercised by the separate KVM acceptance.
        pass

    def prepare(self, row):
        self.guard(row)
        self.client.check()
        self.client.calls["prepare"] += 1
        row["session_key"] = "session-canary-secret"
        self.journal.write(row)
        return {"ref": row["run_id"], "base_sha": row["input"]["base_sha"]}

    def prompt(self, row, goal):
        self.guard(row)
        self.client.check()
        self.client.calls["prompt"] += 1
        if self.client.lose == "prompt":
            raise TimeoutError("prompt reply lost")
        return {"accepted": True}

    def result(self, row):
        self.client.check()
        self.client.calls["result"] += 1
        return {
            "execution_mode": "cocoon-fixture",
            "diff_sha256": "f" * 64,
            "verification": {"status": "passed"},
            "diff": "fixed fixture",
        }

    @contextmanager
    def relay(self, row):
        node = self.client

        class AgentHTTP:
            def expect(self, method, path):
                node.check()
                if path == "/server_info":
                    return {"build_git_sha": OPENHANDS_SHA, "version": OPENHANDS_VERSION}
                if "/events/search" in path:
                    return {
                        "items": [
                            {
                                "id": f"event-{n}",
                                "kind": "MessageEvent",
                                "source": "agent",
                                "llm_message": {"content": str(n)},
                            }
                            for n in range(3)
                        ]
                    }
                return {"id": row["run_id"], "execution_status": "finished"}

        yield AgentHTTP()


class Server:
    def __init__(self, root, repo, base_sha, node=None, connector_type=FixtureConnector):
        root = Path(root)
        token = root / "connector-token"
        if not token.exists():
            token.write_text(secrets.token_urlsafe(32))
            token.chmod(0o600)
        bundle = root / "fixture.bundle"
        bundle.write_bytes(b"not-a-real-git-bundle")
        launcher = root / "terminal"
        binary = bytearray(64)
        binary[:6] = b"\x7fELF\x02\x01"
        binary[18:20] = (62).to_bytes(2, "little")
        launcher.write_bytes(binary)
        launcher.chmod(0o600)
        self.config = {
            "origin": "http://127.0.0.1:17777",
            "template": "localhost:15000/guest@sha256:" + "a" * 64,
            "state_dir": str(root / "state"),
            "terminal_launcher_file": str(launcher),
            "terminal_launcher_sha256": hashlib.sha256(binary).hexdigest(),
            "connector_token_file": str(token),
            "repositories": [
                {
                    "canonical_repo": repo,
                    "base_sha": base_sha,
                    "bundle": str(bundle),
                    "sha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
                }
            ],
        }
        self.node = node or Node(root)
        self.service = connector_type(self.config, client=self.node, host=self.node)
        self.socket = socket.socket()
        self.socket.bind(("127.0.0.1", 0))
        self.origin = f"http://127.0.0.1:{self.socket.getsockname()[1]}"
        self.server = uvicorn.Server(
            uvicorn.Config(
                create_connector({}, self.service), log_level="critical", access_log=False
            )
        )
        self.thread = threading.Thread(
            target=self.server.run, kwargs={"sockets": [self.socket]}, daemon=True
        )
        self.thread.start()
        deadline = time.monotonic() + 5
        while not self.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("fixture server startup failed")
            time.sleep(0.01)
        self.client = RuntimeClient(self.origin, token.read_text())

    def close(self):
        self.server.should_exit = True
        self.thread.join(timeout=5)
        self.socket.close()
