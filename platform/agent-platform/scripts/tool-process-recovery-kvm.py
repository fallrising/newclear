#!/usr/bin/env python3
"""Opt-in actual Worker/connector SIGKILL acceptance on a dedicated sealed KVM node.

Uses the TB-2b setup, API and cleanup driver with a separate process owning the
Worker heartbeat and ToolSession. Configuration and IPC are private. No live
GitHub, paid model or production Worker activation is performed.
"""

import argparse
import json
import select
import signal
import socket
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import UUID

from tool_process_fixture import baseline

from agent_platform.connector_isolation import CODE
from agent_platform.tool_broker.broker import Broker

base = baseline()
CASES = (
    "normal",
    "worker-in-flight",
    "worker-settled",
    "connector-in-flight",
    "connector-delivered",
)


def connector_address(origin):
    address = urlsplit(origin)
    base.require(address.hostname == "127.0.0.1", "loopback_connector_required")
    with socket.socket() as listener:
        # Match uvicorn's restart behavior: a killed server's TIME_WAIT peers do
        # not mean another listener owns this port. A live listener still fails.
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((address.hostname, address.port))
    return address


class Actor:
    def __init__(self, harness, policy):
        self.harness = harness
        log = harness.output / f"worker-{len(harness.actors)}.log"
        with log.open("w") as stream:
            self.process = subprocess.Popen(
                [sys.executable, str(Path(__file__).with_name("tool_process_fixture.py"))],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=stream,
                text=True,
                bufsize=1,
            )
        harness.actors.append(self)
        self.closed = False
        self.send(
            {
                "config": harness.config,
                "origin": harness.origin,
                "policy": asdict(policy),
                **{
                    name: getattr(harness, name)
                    for name in ("catalog", "repo", "project", "profile")
                },
            }
        )
        self.response()

    def send(self, data):
        self.process.stdin.write(json.dumps(data, default=str) + "\n")
        self.process.stdin.flush()

    def response(self, timeout=90):
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            base.require(remaining > 0, "worker_response_timeout")
            ready, _, _ = select.select([self.process.stdout], [], [], remaining)
            base.require(ready, "worker_response_timeout")
            line = self.process.stdout.readline()
            base.require(line, "worker_process_exited")
            result = json.loads(line)
            if "post" in result:
                value = self.harness.post(result["post"], result["data"])
                if result["post"] == "/tasks":
                    self.harness.issued.append(UUID(value["run"]["id"]))
                self.send({"result": value})
                continue
            base.require(result.get("ok") is True, "worker_fixture_failed")
            return result

    def call(self, action, **data):
        self.send({"action": action, **data})
        return self.response()

    def step(self):
        self.closed = self.call("step")["closed"]

    def kill(self):
        base.require(self.process.poll() is None, "worker_died_before_fault")
        self.process.kill()
        base.require(self.process.wait(timeout=10) == -signal.SIGKILL, "worker_not_sigkilled")
        return self.process.pid

    def close(self):
        if self.process.poll() is None:
            try:
                self.call("close")
                self.process.wait(timeout=10)
            except Exception:
                self.process.kill()
                self.process.wait(timeout=10)
        self.process.stdin.close()
        self.process.stdout.close()


class ProcessHarness(base.Harness):
    config_path = output = None

    def __init__(self, config, origin, db, api, post, mock):
        self.actors = []
        self.connectors = []
        self.origin = origin
        self.connector = None
        self.start_connector()
        try:
            super().__init__(config, origin, db, api, post, mock)
        except BaseException:
            self.stop_connector()
            raise

    def start_connector(self):
        address = connector_address(self.origin)
        with (self.output / f"connector-{len(self.connectors)}.log").open("w") as stream:
            self.connector = subprocess.Popen(
                [
                    sys.executable,
                    str(Path(__file__).with_name("tool_process_fixture.py")),
                    "connector",
                    str(self.config_path),
                    str(address.port),
                ],
                stdout=stream,
                stderr=subprocess.STDOUT,
            )
        self.connectors.append(self.connector)

        def ready():
            base.require(self.connector.poll() is None, "connector_process_exited")
            try:
                with socket.create_connection((address.hostname, address.port), timeout=0.2):
                    return True
            except OSError:
                return False

        try:
            base.until(ready, seconds=20)
            first = (
                (self.output / f"connector-{len(self.connectors) - 1}.log")
                .read_text()
                .splitlines()[0]
            )
            identity = json.loads(first)
            base.require(identity["pid"] == self.connector.pid, "connector_identity_mismatch")
            self.connector_epoch = str(UUID(identity["epoch"]))
        except BaseException:
            self.stop_connector()
            raise

    def stop_connector(self):
        if self.connector and self.connector.poll() is None:
            self.connector.terminate()
            try:
                self.connector.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.connector.kill()
                self.connector.wait(timeout=10)

    def restart_connector(self):
        old = self.connector.pid
        old_epoch = self.connector_epoch
        base.require(self.connector.poll() is None, "connector_died_before_fault")
        self.connector.kill()
        base.require(self.connector.wait(timeout=10) == -signal.SIGKILL, "connector_not_sigkilled")
        self.start_connector()
        base.require(self.connector.pid != old, "connector_pid_unchanged")
        base.require(old_epoch != self.connector_epoch, "connector_epoch_unchanged")
        return {
            "old_pid": old,
            "new_pid": self.connector.pid,
            "sigkill_reaped": True,
            "old_epoch": old_epoch,
            "new_epoch": self.connector_epoch,
        }

    def allocate_process(self, case):
        policy = self.mock.policy()
        actor = Actor(self, policy)
        allocated = actor.call("allocate", case=case)
        run_id = UUID(allocated["run_id"])
        context = {
            "run": self.run_snapshot(run_id),
            "session": actor,
            "broker": Broker(self.db, policy),
            "policy": policy,
            "token": allocated["token"],
            "worker": SimpleNamespace(owner=UUID(allocated["owner"])),
        }
        row = self.row(run_id)
        context["sb"] = self.node.attach(
            row["handle"]["owner"], row["handle"]["id"], row["handle"]["token"]
        )
        return context

    def run_snapshot(self, run_id):
        with self.db.transaction() as conn:
            return conn.execute(
                "SELECT r.*,j.lease_until,b.provider_handle FROM runs r "
                "JOIN jobs j ON j.run_id=r.id "
                "JOIN sandbox_bindings b ON b.id=r.sandbox_id WHERE r.id=%s",
                (run_id,),
            ).fetchone()

    def events(self, context):
        events = super().events(context)
        for event in events["events"]:
            if (
                event["payload"]["kind"] == "ObservationEvent"
                and "TOOL_PROCESS_RECEIVED" in event["payload"]["content"]
            ):
                context["sdk_events"]["markers"].append("TOOL_PROCESS_RECEIVED")
        return events

    def operation_evidence(self, context):
        with self.db.transaction() as conn:
            rows = conn.execute(
                "SELECT operation_id,generation,binding_id,status,delivery,http_calls,"
                "response_bytes,(receipt_hash IS NOT NULL) AS has_receipt "
                "FROM tool_broker_operations WHERE run_id=%s ORDER BY admitted_at",
                (context["run"]["id"],),
            ).fetchall()
        return [
            {key: str(value) if isinstance(value, UUID) else value for key, value in row.items()}
            for row in rows
        ]

    def cleanup(self):
        failures = 0
        for actor in self.actors:
            try:
                actor.close()
            except Exception:
                failures += 1
        # The restarted connector remains available for native cancel/stop proof.
        try:
            # A failed restart must not leave native cancellation without its
            # connector while the disposable SQL lease is still available.
            if getattr(self, "connector", None) and self.connector.poll() is not None:
                self.start_connector()
            result = super().cleanup()
        finally:
            self.stop_connector()
        result["cleanup_failures"] += failures
        result["remaining_worker_processes"] = sum(a.process.poll() is None for a in self.actors)
        result["remaining_connector_processes"] = sum(p.poll() is None for p in self.connectors)
        result["cleanup_failures"] += (
            result["remaining_worker_processes"] + result["remaining_connector_processes"]
        )
        return result


def single_fixture(context, *, received):
    base.install_fixture(context["sb"], context["run"]["id"], complete=False)
    expected = base.REPOSITORY if received else {"error": "tool_transport_unavailable"}
    marker = "TOOL_PROCESS_RECEIVED" if received else "TOOL_KVM_WITHHELD"
    program = f"""
import json, subprocess
from pathlib import Path
reply = subprocess.run(['python3', '-I', '{CODE}/guest_tool_client.py',
                        {json.dumps(base.REQUESTS[0])!r}],
                       capture_output=True, text=True, timeout=20)
value = json.loads(reply.stdout)
assert (reply.returncode == 0) is {received!r} and value == {expected!r}
proof = {{'received_result': {received!r}, 'checked': True}}
Path({base.ROUNDTRIP!r}).write_text(json.dumps(proof))
print({marker!r}, flush=True)
"""
    context["sb"].write_file(CODE + "/tool_roundtrip.py", program.encode(), mode=0o644)


def prompt_single(harness, context, *, received=False):
    single_fixture(context, received=received)
    harness.client.operation(context["run"], "prompt")
    events = base.until(lambda: harness.awaiting(context))
    from datetime import UTC, datetime, timedelta
    from uuid import uuid4

    harness.client.approve(
        context["run"],
        {
            "id": uuid4(),
            "action_digest": events["approval"]["action_digest"],
            "expires_at": datetime.now(UTC) + timedelta(seconds=60),
        },
    )


def run_case(harness, case):
    harness.mock.reset(hold=case != "normal")
    context = harness.allocate_process(case)
    actor, run = context["session"], context["run"]
    result = {"case": case, "worker_pid": actor.process.pid}
    if case == "normal":
        result.update(harness.complete(context))
    else:
        prompt_single(harness, context, received=case == "connector-delivered")
        base.until(lambda: harness.tick(context), seconds=20)
        if case.endswith("in-flight"):
            base.require(harness.mock.waiting.is_set(), "upstream_not_blocked_at_crash")
        else:
            base.require(harness.mock.waiting.is_set(), "settlement_barrier_not_held")
            harness.mock.release.set()
            base.until(lambda: harness.operations(context)[0]["status"] == "succeeded", seconds=5)
            base.require(
                harness.row(run["id"])["tool_channel"]["current"]["state"] == "pending",
                "delivery_started_before_barrier",
            )
            if case == "connector-delivered":
                actor.step()
                base.require(
                    harness.row(run["id"])["tool_channel"]["current"]["state"] == "delivered",
                    "delivery_barrier_missing",
                )
        before = harness.operation_evidence(context)
        result["before_crash"] = before
        if case.startswith("worker-"):
            remaining = harness.scalar(
                "SELECT EXTRACT(EPOCH FROM lease_until-clock_timestamp()) "
                "FROM jobs WHERE run_id=%s",
                (run["id"],),
            )
            base.require(remaining > 0, "lease_already_expired_before_crash")
            started = time.monotonic()
            killed = actor.kill()
            harness.mock.release.set()
            successor = Actor(harness, context["policy"])
            recovered = successor.call("recover", run_id=str(run["id"]), old_token=context["token"])
            base.require(
                recovered["pid"] != killed and recovered["owner"] != str(context["worker"].owner),
                "worker_identity_unchanged",
            )
            base.require(
                recovered["generation"] > run["generation"]
                and recovered["binding_id"] == str(run["sandbox_id"]),
                "recovery_binding_changed",
            )
            base.require(
                recovered["state"] == "interrupted" and recovered["cleanup_state"] == "unknown",
                "unsafe_recovery_state",
            )
            context["run"] = harness.run_snapshot(run["id"])
            # The cursor was consumed by the controller; preserve it on takeover.
            context["run"]["backend_cursor"] = run["backend_cursor"]
            result.update(recovered)
            result.update(
                sigkill_reaped=True,
                natural_lease_expiry=True,
                old_pid=killed,
                lease_remaining_at_kill_seconds=float(remaining),
                takeover_elapsed_seconds=round(time.monotonic() - started, 3),
            )
        else:
            journal_before = harness.row(run["id"])["tool_channel"]
            result.update(harness.restart_connector())
            base.require(
                harness.row(run["id"])["tool_channel"] == journal_before, "restart_rewrote_channel"
            )
            for action in ("poll", "bind"):
                base.deny(lambda action=action: harness.client.tool(run, action))
            actor.step()
            base.require(actor.closed, "old_session_survived_connector_restart")
            harness.mock.release.set()
            result.update(old_channel_denied=True, journal_preserved=True)
        base.require(harness.reserved(run["id"]) == 1, "crash_released_capacity")
        harness.finished(
            context,
            "TOOL_PROCESS_RECEIVED" if case == "connector-delivered" else "TOOL_KVM_WITHHELD",
        )
        rows = harness.operation_evidence(context)
        if case.startswith("worker-"):
            base.require(rows == before, "worker_crash_rewrote_durable_operation")
        base.require(len(rows) == 1 and rows[0]["delivery"] != "acknowledged", "crash_invented_ack")
        base.require(
            harness.mock.calls == harness.mock.authenticated == 1, "crash_replayed_operation"
        )
        result.update(
            after_recovery=rows,
            original_dispatches=1,
            no_replay=True,
            capacity_retained=True,
            already_delivered=case == "connector-delivered",
        )
    result.update(harness.cancel(run["id"]))
    base.require(not harness.node.sandboxes() and not harness.host.vms(), "case_cleanup_incomplete")
    result.update(context.get("sdk_completion", {}))
    result["passed"] = True
    return result


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args, _ = parser.parse_known_args()
    ProcessHarness.config_path, ProcessHarness.output = args.config, args.output
    # Reuse only the existing acceptance CLI's fresh-DB/API/report/cleanup shell.
    # Production code and the normal Worker have no injected crash hooks.
    base.CASES, base.Harness, base.run_case = CASES, ProcessHarness, run_case
    base.main()


if __name__ == "__main__":
    main()
