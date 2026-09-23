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
from .connector_isolation import CODE, CONTROL, HELPERS, REVISION, attest
from .connector_journal import Journal, private_file
from .connector_output import OutputPolicy, workspace_result
from .connector_recovery import inspect
from .domain import Input, Problem

MAX_BUNDLE = 8 * 1024 * 1024


class Allocate(Input):
    generation: int = Field(ge=1)
    template: str
    canonical_repo: str
    base_sha: str = Field(pattern=r"^([a-f0-9]{40}|[a-f0-9]{64})$")
    deadline: datetime
    require_approval: bool = False


class Cancel(Input):
    generation: int = Field(ge=1)


class Control(Input):
    generation: int = Field(ge=1)
    action: Literal["pause", "resume"]
    command_id: UUID
    pause_id: UUID


class Approve(Input):
    generation: int = Field(ge=1)
    approval_id: UUID
    action_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expires_at: datetime


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
        self.launcher()  # Validate the private pinned launcher before accepting runs.
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

    def launcher(self):
        path = private_file(self.config["terminal_launcher_file"])
        if path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError("terminal_launcher_too_large")
        data = path.read_bytes()
        if (
            data[:6] != b"\x7fELF\x02\x01"
            or len(data) < 64
            or int.from_bytes(data[18:20], "little") != 62
            or hashlib.sha256(data).hexdigest() != self.config["terminal_launcher_sha256"]
        ):
            raise ValueError("terminal_launcher_mismatch")
        return data

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

    def guard(self, row, *, stopping=False, controlling=False):
        self.fences.require(row["run_id"], row["generation"])
        if row.get("pause", {}).get("hold") and not (stopping or controlling):
            raise Problem(409, "sandbox_pause_requested")
        if row.get("cancel_requested") and not stopping:
            raise Problem(409, "sandbox_cancel_requested")

    def cancel(self, run_id, generation):
        from .connector_cancel import cancel

        return cancel(self, run_id, generation)

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
                self.guard(row)
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
        sb.exec("install", "-d", "-m", "0755", CODE, timeout=10)
        for name in HELPERS:
            self.guard(row)
            sb.write_file(
                CODE + "/" + name,
                Path(__file__).with_name(name).read_bytes(),
                mode=0o644,
            )
        self.guard(row)
        sb.exec(
            "python3", "-I", CODE + "/guest_control.py", json.dumps({"action": "setup"}), timeout=10
        )
        sb.write_file(CODE + "/terminal", self.launcher(), mode=0o700)
        sb.exec("chown", "0:2001", CODE + "/terminal", timeout=5)
        sb.exec("chmod", "4750", CODE + "/terminal", timeout=5)
        checkout = json.loads(
            sb.exec(
                "python3",
                "-I",
                CODE + "/guest_workspace.py",
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
            "-I",
            CODE + "/guest_fixture.py",
            user="agentcontrol",
            cwd=CONTROL,
            env={"FIXTURE_RUN_ID": row["run_id"]},
        )
        self.guard(row)
        sb.spawn(
            "python3",
            "-I",
            CODE + "/guest_control.py",
            json.dumps({"action": "serve"}),
            user="agentcontrol",
            cwd=CONTROL,
            env={"SESSION_API_KEY": row["session_key"], "OPENHANDS_BUILD_GIT_SHA": OPENHANDS_SHA},
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
                        "working_dir": CONTROL + "/workspace",
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
                        "tools": [
                            {
                                "name": "terminal",
                                "params": {
                                    "terminal_type": "subprocess",
                                    "shell_path": CODE + "/terminal",
                                },
                            }
                        ],
                        "agent_context": {
                            "load_user_skills": False,
                            "load_public_skills": False,
                            "load_project_skills": False,
                            "load_memory": False,
                        },
                    },
                    "confirmation_policy": {
                        "kind": "AlwaysConfirm" if data.get("require_approval") else "NeverConfirm"
                    },
                    "max_iterations": 4,
                    "autotitle": False,
                },
                codes=(200, 201),
            )
            if created.get("id") != row["run_id"]:
                raise Problem(409, "conversation_mismatch")
        row["isolation_revision"] = REVISION
        self.isolation(row)
        self.journal.write(row)
        return {"ref": row["run_id"], **checkout}

    def isolation(self, row, *, terminal=False):
        return attest(self, row, terminal=terminal)

    def prompt(self, row, goal):
        self.isolation(row)
        with self.relay(row) as http:
            path = "/api/conversations/" + row["run_id"]
            self.guard(row)
            http.expect(
                "POST",
                path + "/events",
                {"role": "user", "content": [{"type": "text", "text": goal}], "run": False},
            )
            # send_message(run=False) initializes the terminal before any tool admission.
            row["guest_baseline"] = self.quiescence(row)
            self.journal.write(row)
            self.guard(row)
            http.expect("POST", path + "/run")
        return {"accepted": True}

    def quiescence(self, row, baseline=None):
        self.isolation(row, terminal=True)
        expected = hashlib.sha256(
            Path(__file__).with_name("guest_quiescence.py").read_bytes()
        ).hexdigest()
        sb = self.handle(row)
        if sb.exec("sha256sum", CODE + "/guest_quiescence.py", timeout=5).split()[0] != expected:
            raise Problem(409, "guest_probe_changed")
        request = {"action": "check", "baseline": baseline} if baseline else {"action": "baseline"}
        return json.loads(
            sb.exec("python3", "-I", CODE + "/guest_quiescence.py", json.dumps(request), timeout=5)
        )

    def conversation(self, row, http):
        if row.get("pause"):
            from .connector_state import live_state

            return live_state(row, http)
        return http.expect("GET", "/api/conversations/" + row["run_id"])

    def events(self, run_id, generation, cursor):
        with self.journal.locked(run_id):
            row = self.require(run_id, generation)
            if row["operations"].get("release", {}).get("state") == "completed":
                raise Problem(409, "sandbox_already_released")
            with self.relay(row) as http:
                path = "/api/conversations/" + row["run_id"]
                state = self.conversation(row, http)["execution_status"]
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
            policy = OutputPolicy(self, row)
            state = policy.metadata(state, 128)
            ids = [policy.metadata(e["id"]) for e in all_events]
            if len(set(ids)) != len(ids):
                raise Problem(409, "backend_duplicate_event")
            if cursor and cursor not in ids:
                raise Problem(409, "backend_event_gap")
            pending = all_events[ids.index(cursor) + 1 :] if cursor else all_events
            normalized = []
            for item in pending[:100]:
                kind = policy.metadata(item.get("kind", "unknown"), 128)
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
                content = json.dumps(policy.redact(selected), ensure_ascii=False)
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
                        else "tool.proposed"
                        if kind == "ActionEvent" and row["input"].get("require_approval")
                        else "tool.started"
                        if kind == "ActionEvent"
                        else "backend.event",
                        "payload": payload,
                    }
                )
            response = {"events": normalized, "state": state, "caught_up": len(pending) <= 100}
            if state == "waiting_for_confirmation":
                from .connector_approval import pending_approval

                response["approval"] = pending_approval(self, row)
            return response

    def result(self, row):
        self.isolation(row, terminal=True)
        sb = self.handle(row)
        with self.relay(row) as http:
            status = http.expect("GET", "/api/conversations/" + row["run_id"])["execution_status"]
        if status != "finished":
            raise Problem(409, "agent_not_finished")
        self.guard(row)
        raw = sb.exec(
            "python3",
            "-I",
            CODE + "/guest_workspace.py",
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
        return workspace_result(raw, row, OutputPolicy(self, row))

    def release(self, row):
        if not row.get("observed"):
            raise Problem(409, "vm_ownership_unconfirmed")
        self.guard(row, stopping=True)
        self.handle(row).close()
        proof = self.host.wait_removed(row["observed"])
        if any(s["id"] == row["handle"]["id"] for s in self.client.sandboxes()):
            raise Problem(409, "claim_still_present")
        return {"observed_state": "stopped", "proof": proof}

    def mutate(self, run_id, request):
        with self.journal.locked(run_id):
            row = self.require(run_id, request.generation)
            self.guard(row, stopping=request.action == "release")
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

    @app.post("/v1/runs/{run_id}/cancel")
    def cancel_run(run_id: UUID, data: Cancel, _=auth):
        return service.cancel(run_id, data.generation)

    @app.post("/v1/runs/{run_id}/control")
    def control_run(run_id: UUID, data: Control, _=auth):
        from .connector_control import control

        return control(service, run_id, data)

    @app.post("/v1/runs/{run_id}/approve")
    def approve_run(run_id: UUID, data: Approve, _=auth):
        from .connector_approval import approve

        return approve(service, run_id, data)

    @app.post("/v1/runs/{run_id}/operations")
    def mutate(run_id: UUID, data: Mutation, _=auth):
        return service.mutate(run_id, data)

    @app.get("/v1/runs/{run_id}/events")
    def events(run_id: UUID, generation: int, cursor: str | None = None, _=auth):
        return service.events(run_id, generation, cursor)

    return app
