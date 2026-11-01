"""Private stdio worker fixture for process recovery acceptance; never a service."""

import importlib.util
import json
import os
import sys
from contextlib import ExitStack
from dataclasses import fields
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

from agent_platform.connector_journal import private_file
from agent_platform.db import Database
from agent_platform.domain import Problem
from agent_platform.runtime_client import RuntimeClient
from agent_platform.runtime_worker import heartbeat
from agent_platform.tool_broker.broker import Broker
from agent_platform.tool_broker.policy import Policy
from agent_platform.tool_session import ToolSession
from agent_platform.worker import Worker
from agent_platform_m0.kvm_lifecycle import Host
from agent_platform_m0.sandbox_client import SingleNodeClient


def baseline():
    spec = importlib.util.spec_from_file_location(
        "tool_kvm_baseline", Path(__file__).with_name("tool-broker-kvm.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def policy_value(value):
    value = dict(value)
    for name in ("service_id", "credential_revision"):
        value[name] = UUID(value[name])
    for field in fields(Policy):
        if field.name in {"paths", "issues", "operations"}:
            value[field.name] = tuple(value[field.name])
    return Policy(**value)


def emit(value):
    print(json.dumps(value, default=str), flush=True)


def receive():
    line = sys.stdin.readline()
    if not line:
        raise EOFError
    return json.loads(line)


def rpc_post(path, data):
    emit({"post": path, "data": data})
    return receive()["result"]


def main():
    init = receive()
    base = baseline()
    policy = policy_value(init["policy"])
    db = Database(os.environ["TEST_DATABASE_URL"])
    db.open()
    harness = None
    context = None
    try:
        # Parent already registered the catalog before allocation. Re-registering
        # while recovering a reserved VM must remain forbidden by production.
        config = init["config"]
        harness = base.Harness.__new__(base.Harness)
        harness.config, harness.db = config, db
        harness.client = RuntimeClient(
            init["origin"], private_file(config["connector_token_file"]).read_text().strip()
        )
        harness.node = SingleNodeClient(
            config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
        )
        harness.host = Host(Path(config["cocoon_config"]), Path(config["sandbox_data_dir"]))
        for name in ("catalog", "repo", "project", "profile"):
            setattr(harness, name, init[name])
        harness.stack, harness.issued = ExitStack(), []
        harness.post = rpc_post
        harness.mock = SimpleNamespace(policy=lambda: policy)
        emit({"ok": True, "pid": os.getpid()})
        while True:
            command = receive()
            action = command["action"]
            if action == "allocate":
                context = harness.allocate(command["case"])
                emit(
                    {
                        "ok": True,
                        "run_id": context["run"]["id"],
                        "owner": context["worker"].owner,
                        "token": context["session"].token,
                        "generation": context["run"]["generation"],
                    }
                )
            elif action == "step":
                context["session"].step()
                emit({"ok": True, "closed": context["session"].closed})
            elif action == "recover":
                worker = Worker(db, harness.client)
                base.until(lambda worker=worker: worker.reconcile_expired() == 1, seconds=45)
                claim = worker.claim()
                base.require(
                    claim and str(claim["run_id"]) == command["run_id"], "recovery_claim_mismatch"
                )
                harness.stack.enter_context(heartbeat(worker, claim))
                run = harness.snapshot(worker, claim)
                harness.client.fence(run)
                broker = Broker(db, policy)
                try:
                    broker.authorize(run["id"], command["old_token"])
                except Problem:
                    old_denied = True
                else:
                    old_denied = False
                session = ToolSession(
                    broker,
                    harness.client,
                    run_id=run["id"],
                    generation=run["generation"],
                    owner=worker.owner,
                    binding_id=run["sandbox_id"],
                )
                harness.stack.callback(session.close)
                session.step()
                base.require(old_denied and session.closed, "recovery_restored_tool_authority")
                context = {"run": run, "worker": worker, "session": session}
                emit(
                    {
                        "ok": True,
                        "pid": os.getpid(),
                        "owner": worker.owner,
                        "generation": run["generation"],
                        "binding_id": run["sandbox_id"],
                        "state": run["state"],
                        "cleanup_state": run["cleanup_state"],
                        "old_token_denied": old_denied,
                        "fresh_session_denied": session.closed,
                    }
                )
            elif action == "close":
                emit({"ok": True})
                return
            else:
                raise ValueError("unknown_fixture_command")
    except Exception as exc:
        import traceback

        traceback.print_exc(file=sys.stderr)
        emit({"ok": False, "error_type": type(exc).__name__})
        raise SystemExit(1) from None
    finally:
        if harness:
            harness.stack.close()
        db.close()


def connector_main(config_path, port):
    import uvicorn

    from agent_platform.connector import Connector, create_connector

    config = json.loads(private_file(config_path).read_text())
    service = Connector(config)
    emit({"pid": os.getpid(), "epoch": service.tool_epoch})
    uvicorn.run(
        create_connector(config, service=service),
        host="127.0.0.1",
        port=int(port),
        access_log=False,
        proxy_headers=False,
    )


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "connector":
        connector_main(sys.argv[2], sys.argv[3])
    else:
        main()
