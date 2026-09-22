"""Host-local connector. Only fixed templates/bundles and bounded guest operations.

The API/worker never receive node or guest credentials. A private durable journal
quarantines uncertain mutations; recovery only reattaches proven instances.
"""

import hashlib
import hmac
import json
import math
import secrets
import shutil
import socket
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode
from uuid import UUID

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import Field

from agent_platform_m0.contracts import OPENHANDS_BINARY_SHA256, OPENHANDS_SHA, OPENHANDS_VERSION
from agent_platform_m0.kvm_lifecycle import Host
from agent_platform_m0.probe import wait_ready
from agent_platform_m0.sandbox_client import SingleNodeClient
from agent_platform_m0.sandbox_smoke import Config
from agent_platform_m0.transport import HTTP

from .connector_fence import Fences, Lease
from .connector_journal import Journal, private_file
from .connector_recovery import inspect
from .domain import Input, Problem

MAX_BUNDLE = 8 * 1024 * 1024


class Allocate(Input):
    generation: int = Field(ge=1)
    template: str
    canonical_repo: str
    base_sha: str = Field(pattern=r"^([a-f0-9]{40}|[a-f0-9]{64})$")
    deadline: datetime


class Mutation(Input):
    generation: int = Field(ge=1)
    action: Literal["prepare", "prompt", "result", "release"]
    goal: str = Field(default="", max_length=20000)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class Connector:
    def __init__(self, config, *, client=None, host=None):
        self.config = config
        Config(config["origin"], config["template"]).validate()
        self.journal = Journal(config["state_dir"])
        self.fences = Fences(Path(config["state_dir"]) / "fences")
        self.token = private_file(config["connector_token_file"]).read_text().strip()
        if len(self.token) < 32:
            raise ValueError("connector_token_too_short")
        self.client = client or SingleNodeClient(
            config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
        )
        self.host = host or Host(Path(config["cocoon_config"]), Path(config["sandbox_data_dir"]))
        self.admission = threading.Lock()
        self.entries = {}
        for entry in config["repositories"]:
            key = (entry["canonical_repo"], entry["base_sha"])
            if key in self.entries:
                raise ValueError("duplicate_catalog_revision")
            self.entries[key] = entry
            self.bundle(entry)  # Fail configuration before accepting any run.

    def close(self):
        self.fences.close()
        self.journal.close()

    def bundle(self, entry):
        path = Path(entry["bundle"])
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_BUNDLE:
            raise Problem(422, "invalid_repository_bundle")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise Problem(422, "repository_bundle_changed")
        return data

    def catalog(self):
        return {
            "node_id": "cocoon-local",
            "template_digest": self.config["template"],
            "slots": 4,
            "cpu": 16,
            "memory_bytes": 16 * 1024**3,
            "repositories": [
                {k: v for k, v in e.items() if k in {"canonical_repo", "base_sha", "sha256"}}
                for e in self.entries.values()
            ],
        }

    def require(self, run_id, generation):
        self.fences.require(run_id, generation)
        row = self.journal.read(run_id)
        if not row:
            raise Problem(404, "connector_run_not_found")
        if row["generation"] > generation:
            raise Problem(409, "connector_generation_stale")
        if row["generation"] < generation:
            row["generation"] = generation
            self.journal.write(row)
        return row

    def guard(self, row):
        self.fences.require(row["run_id"], row["generation"])

    def inspect(self, run_id, generation):
        return inspect(self, run_id, generation)

    def handle(self, row):
        value = row.get("handle")
        if not value:
            raise Problem(409, "allocation_unconfirmed")
        return self.client.attach(value["owner"], value["id"], value["token"])

    def allocate(self, run_id, request):
        data = request.model_dump(mode="json")
        if request.template != self.config["template"]:
            raise Problem(422, "template_not_registered")
        entry = self.entries.get((request.canonical_repo, request.base_sha))
        if not entry:
            raise Problem(422, "repository_revision_not_registered")
        if request.deadline.tzinfo is None:
            raise Problem(422, "deadline_requires_timezone")
        with self.journal.locked(run_id), self.admission:
            self.fences.require(run_id, request.generation)
            row = self.journal.read(run_id)
            if row:
                row = self.require(run_id, request.generation)
                data["generation"] = row["input"]["generation"]
            else:
                row = {
                    "run_id": str(run_id),
                    "generation": request.generation,
                    "input": data,
                    "claim_ref": "ap-m2-" + str(run_id),
                    "operations": {},
                }

            def effect():
                ttl = math.ceil((request.deadline - datetime.now(UTC)).total_seconds()) + 120
                if not 121 <= ttl <= 7320:
                    raise Problem(422, "run_deadline_invalid")
                # Dedicated zero-warm node: actual claims/VMs plus uncertain intents block
                # admission.
                info = self.client.info()
                if any(p["target"] != 0 for p in info["pools"]):
                    raise Problem(409, "warm_pool_not_supported")
                pending = [json.loads(p.read_text()) for p in self.journal.root.glob("*.json")]
                unresolved = [
                    r
                    for r in pending
                    if r["operations"].get("allocate", {}).get("state") == "started"
                    and not r.get("handle")
                    and r["run_id"] != str(run_id)
                ]
                if unresolved:
                    raise Problem(409, "unresolved_allocation_blocks_admission")
                if max(len(self.client.sandboxes()), len(self.host.vms())) >= 4:
                    raise Problem(409, "node_capacity_unavailable")
                self.check_host_reserve()
                self.guard(row)
                sb = self.client.new(
                    request.template,
                    net="none",
                    size="large",
                    ttl_seconds=ttl,
                    claim_ref=row["claim_ref"],
                    deadline=time.monotonic() + 120,
                )
                row["handle"] = {"owner": sb.owner, "id": sb.id, "token": sb.token}
                self.journal.write(row)  # Preserve handle before any fallible attestation.
                claimed = [s for s in self.client.sandboxes() if s["id"] == sb.id]
                if (
                    sb.template_digest
                    or len(claimed) != 1
                    or claimed[0].get("claim_ref") != row["claim_ref"]
                    or claimed[0].get("key")
                    != {"template": request.template, "net": "none", "size": "large"}
                ):
                    raise Problem(409, "claim_attestation_failed")
                expiry = datetime.fromisoformat(sb.deadline.replace("Z", "+00:00"))
                if expiry < request.deadline.replace(microsecond=0) + __import__(
                    "datetime"
                ).timedelta(seconds=119):
                    raise Problem(409, "sandbox_ttl_insufficient")
                observed = self.host.observe(sb.id)
                row["observed"] = observed
                self.journal.write(row)
                if (
                    observed["image_digest"] != request.template.split("@")[1]
                    or observed["cpu"] != 4
                    or observed["memory_bytes"] != 4 * 1024**3
                ):
                    raise Problem(409, "vm_resource_or_template_mismatch")
                return {
                    "handle": sb.id,
                    "observed_state": "running",
                    "lease_deadline": sb.deadline,
                    "vm_id": observed["vm_id"],
                }

            return self.journal.operation(row, "allocate", fingerprint(data), effect)

    def check_host_reserve(self):
        memory = {
            line.split(":")[0]: int(line.split()[1]) * 1024
            for line in Path("/proc/meminfo").read_text().splitlines()
            if line.startswith(("MemTotal:", "MemAvailable:"))
        }
        reserve = max(4 * 1024**3, memory["MemTotal"] // 5)
        if memory["MemAvailable"] < reserve + 4 * 1024**3:
            raise Problem(409, "host_memory_reserve_unavailable")
        if shutil.disk_usage(self.host.config["root_dir"]).free < 12 * 1024**3:
            raise Problem(409, "host_disk_reserve_unavailable")

    @contextmanager
    def relay(self, row):
        listener = self.handle(row).proxy_port("127.0.0.1:0", 8000)
        try:
            yield HTTP(f"http://127.0.0.1:{listener.getsockname()[1]}", row["session_key"])
        finally:
            try:
                listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            listener.close()

    def prepare(self, row):
        sb = self.handle(row)
        if (
            sb.exec("sha256sum", "/usr/local/bin/openhands-agent-server", timeout=15).split()[0]
            != OPENHANDS_BINARY_SHA256
        ):
            raise Problem(409, "guest_binary_mismatch")
        data = row["input"]
        self.guard(row)
        sb.write_file(
            "/tmp/source.bundle",
            self.bundle(self.entries[(data["canonical_repo"], data["base_sha"])]),
            mode=0o644,
        )
        for name in ["guest_fixture.py", "guest_workspace.py"]:
            self.guard(row)
            sb.write_file("/tmp/" + name, Path(__file__).with_name(name).read_bytes(), mode=0o644)
        self.guard(row)
        checkout = json.loads(
            sb.exec(
                "python3",
                "/tmp/guest_workspace.py",
                json.dumps({"action": "checkout", "base_sha": data["base_sha"]}),
                user="agentprobe",
                timeout=90,
            )
        )
        row["session_key"] = secrets.token_urlsafe(32)
        self.journal.write(row)
        self.guard(row)
        sb.spawn(
            "python3",
            "/tmp/guest_fixture.py",
            user="agentprobe",
            env={"FIXTURE_RUN_ID": row["run_id"]},
        )
        self.guard(row)
        sb.spawn(
            "/usr/local/bin/openhands-agent-server",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
            user="agentprobe",
            cwd="/home/agentprobe",
            env={
                "SESSION_API_KEY": row["session_key"],
                "HOME": "/home/agentprobe",
                "OPENHANDS_BUILD_GIT_SHA": OPENHANDS_SHA,
                "OH_CONVERSATIONS_PATH": "/home/agentprobe/.openhands-state/conversations",
                "OH_BASH_EVENTS_DIR": "/home/agentprobe/.openhands-state/bash-events",
                "OPENHANDS_AGENT_SERVER_CONFIG_PATH": (
                    "/home/agentprobe/.openhands-state/config.json"
                ),
            },
        )
        with self.relay(row) as http:
            wait_ready(http)
            info = http.expect("GET", "/server_info")
            if (
                info.get("build_git_sha") != OPENHANDS_SHA
                or info.get("version") != OPENHANDS_VERSION
            ):
                raise Problem(409, "agent_version_mismatch")
            self.guard(row)
            created = http.expect(
                "POST",
                "/api/conversations",
                {
                    "conversation_id": row["run_id"],
                    "workspace": {
                        "kind": "LocalWorkspace",
                        "working_dir": "/home/agentprobe/workspace",
                    },
                    "agent": {
                        "kind": "Agent",
                        "llm": {
                            "model": "openai/gpt-4o-mini",
                            "base_url": "http://127.0.0.1:18080/v1",
                            "api_key": "m2-fixture-no-provider-key",
                            "stream": False,
                            "num_retries": 0,
                        },
                        "tools": [{"name": "terminal"}],
                    },
                    "max_iterations": 4,
                    "autotitle": False,
                },
                codes=(200, 201),
            )
            if created.get("id") != row["run_id"]:
                raise Problem(409, "conversation_mismatch")
        return {"ref": row["run_id"], **checkout}

    def prompt(self, row, goal):
        with self.relay(row) as http:
            path = "/api/conversations/" + row["run_id"]
            self.guard(row)
            http.expect(
                "POST",
                path + "/events",
                {"role": "user", "content": [{"type": "text", "text": goal}], "run": False},
            )
            self.guard(row)
            http.expect("POST", path + "/run")
        return {"accepted": True}

    def events(self, run_id, generation, cursor):
        with self.journal.locked(run_id):
            row = self.require(run_id, generation)
            if row["operations"].get("release", {}).get("state") == "completed":
                raise Problem(409, "sandbox_already_released")
            with self.relay(row) as http:
                path = "/api/conversations/" + row["run_id"]
                state = http.expect("GET", path)["execution_status"]
                all_events, page_id, seen = [], None, set()
                for _ in range(100):
                    query = {"limit": 100}
                    if page_id:
                        query["page_id"] = page_id
                    page = http.expect("GET", path + "/events/search?" + urlencode(query))
                    all_events.extend(page["items"])
                    page_id = page.get("next_page_id")
                    if not page_id:
                        break
                    if page_id in seen:
                        raise Problem(409, "backend_pagination_cycle")
                    seen.add(page_id)
                else:
                    raise Problem(409, "backend_history_limit")
            ids = [str(e["id"]) for e in all_events]
            if len(set(ids)) != len(ids):
                raise Problem(409, "backend_duplicate_event")
            if cursor and cursor not in ids:
                raise Problem(409, "backend_event_gap")
            pending = all_events[ids.index(cursor) + 1 :] if cursor else all_events
            normalized = []
            for item in pending[:100]:
                kind = item.get("kind", "unknown")
                # Bounded, text-only representation; never persist runtime authentication/state
                # blobs.
                selected = {
                    k: item[k]
                    for k in [
                        "source",
                        "llm_message",
                        "action",
                        "observation",
                        "key",
                        "value",
                        "tool_name",
                    ]
                    if k in item
                }
                if kind == "ConversationStateUpdateEvent" and item.get("key") != "execution_status":
                    selected = {"key": item.get("key"), "detail": "state metadata omitted"}
                content = json.dumps(selected, ensure_ascii=False, default=str)
                for secret in [row["session_key"], row["handle"]["token"], self.token]:
                    content = content.replace(secret, "[redacted]")
                payload = {
                    "kind": kind,
                    "content": content[:16000],
                    "truncated": len(content) > 16000,
                }
                normalized.append(
                    {
                        "event_id": str(item["id"]),
                        "cursor": str(item["id"]),
                        "type": "tool.completed"
                        if kind == "ObservationEvent"
                        else "tool.started"
                        if kind == "ActionEvent"
                        else "backend.event",
                        "payload": payload,
                    }
                )
            return {"events": normalized, "state": state, "caught_up": len(pending) <= 100}

    def result(self, row):
        sb = self.handle(row)
        with self.relay(row) as http:
            status = http.expect("GET", "/api/conversations/" + row["run_id"])["execution_status"]
        if status != "finished":
            raise Problem(409, "agent_not_finished")
        self.guard(row)
        result = json.loads(
            sb.exec(
                "python3",
                "/tmp/guest_workspace.py",
                json.dumps(
                    {
                        "action": "result",
                        "run_id": row["run_id"],
                        "base_sha": row["input"]["base_sha"],
                    }
                ),
                user="agentprobe",
                timeout=90,
            )
        )
        return {
            "execution_mode": "cocoon-fixture",
            "summary": "OpenHands 已在獨立 VM 執行固定的檔案修改驗收。",
            **result,
        }

    def release(self, row):
        if not row.get("observed"):
            raise Problem(409, "vm_ownership_unconfirmed")
        self.guard(row)
        self.handle(row).close()
        proof = self.host.wait_removed(row["observed"])
        if any(s["id"] == row["handle"]["id"] for s in self.client.sandboxes()):
            raise Problem(409, "claim_still_present")
        return {"observed_state": "stopped", "proof": proof}

    def mutate(self, run_id, request):
        with self.journal.locked(run_id):
            row = self.require(run_id, request.generation)
            if request.action != "release" and datetime.fromisoformat(
                row["input"]["deadline"]
            ) <= datetime.now(UTC):
                raise Problem(409, "run_deadline_expired")
            prerequisites = {"prepare": "allocate", "prompt": "prepare", "result": "prompt"}
            prerequisite = prerequisites.get(request.action)
            if prerequisite and row["operations"].get(prerequisite, {}).get("state") != "completed":
                raise Problem(409, "connector_prerequisite_unconfirmed")
            released = row["operations"].get("release")
            if request.action != "release" and released:
                raise Problem(409, "sandbox_release_started")
            actions = {
                "prepare": lambda: self.prepare(row),
                "prompt": lambda: self.prompt(row, request.goal),
                "result": lambda: self.result(row),
                "release": lambda: self.release(row),
            }
            payload = request.model_dump()
            # Operation identity survives ownership transfer; generation fences admission.
            payload["generation"] = row["input"]["generation"]
            return self.journal.operation(
                row, request.action, fingerprint(payload), actions[request.action]
            )


def create_connector(config, service=None):
    service = service or Connector(config)

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            service.close()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.exception_handler(Problem)
    async def problem(request, exc):
        return JSONResponse({"error": exc.code}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        return JSONResponse({"error": "invalid_connector_input"}, status_code=422)

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        return JSONResponse({"error": "connector_operation_uncertain"}, status_code=503)

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        if request.headers.get("origin"):
            return JSONResponse({"error": "browser_origin_forbidden"}, status_code=403)
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > 65536:
                return JSONResponse({"error": "request_too_large"}, status_code=413)
            chunks.append(chunk)
        request._body = b"".join(chunks)
        try:
            response = await call_next(request)
        except Exception:
            # Do not let upstream error text (or credentials) enter general server logs.
            response = JSONResponse({"error": "connector_operation_uncertain"}, status_code=503)
        response.headers["Cache-Control"] = "no-store"
        return response

    def authorize(x_session_api_key: str | None = Header(default=None)):
        if not x_session_api_key or not hmac.compare_digest(x_session_api_key, service.token):
            raise Problem(401, "connector_authentication_required")

    auth = Depends(authorize)

    @app.get("/v1/catalog")
    def catalog(_=auth):
        return service.catalog()

    @app.post("/v1/runs/{run_id}")
    def allocate(run_id: UUID, data: Allocate, _=auth):
        return service.allocate(run_id, data)

    @app.put("/v1/runs/{run_id}/lease")
    def lease(run_id: UUID, data: Lease, _=auth):
        return service.fences.grant(run_id, data)

    @app.get("/v1/runs/{run_id}")
    def inspect_run(run_id: UUID, generation: int, _=auth):
        return service.inspect(run_id, generation)

    @app.post("/v1/runs/{run_id}/operations")
    def mutate(run_id: UUID, data: Mutation, _=auth):
        return service.mutate(run_id, data)

    @app.get("/v1/runs/{run_id}/events")
    def events(run_id: UUID, generation: int, cursor: str | None = None, _=auth):
        return service.events(run_id, generation, cursor)

    return app
