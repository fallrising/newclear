#!/usr/bin/env python3
"""Partial AT-07 on two real VMs: output boundary, current egress and isolation.

Uses the product connector in-process, with its real journal/fence/Agent Server.
HTTP/DB/SSE are covered separately by test_output_security.py. The guest fixture
adds a deliberately disclosed session canary and (second VM) a secret patch.
This artificial disclosure tests filtering separately from control isolation.
Never use this driver to claim complete AT-07 or arbitrary-code guest isolation.
"""

import argparse
import json
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from agent_platform.connector import Allocate, Connector, Mutation
from agent_platform.connector_fence import Lease
from agent_platform.connector_journal import private_file
from agent_platform.connector_output import OutputPolicy
from agent_platform.connector_recovery import stopped
from agent_platform.domain import Problem

GUEST = r"""
import http.client,json,os,socket,sys
from pathlib import Path
mode,other_marker=sys.argv[1:]
keys=set()
for path in Path('/proc').glob('[0-9]*/environ'):
    try:
        for entry in path.read_bytes().split(bytes([0])):
            if entry.startswith(b'SESSION_API_KEY='):
                keys.add(entry.split(b'=',1)[1].decode())
    except (OSError,UnicodeError):
        pass
statuses={}
for name,method,target in [
    ('public_http','GET','http://example.com/'),
    ('public_https','CONNECT','example.com:443'),
    ('metadata','GET','http://169.254.169.254/latest/meta-data/'),
    ('private','GET','http://10.0.0.1/'),
    ('loopback','GET','http://127.0.0.1:7788/v1/info'),
    ('ipv6_loopback','GET','http://[::1]:7788/v1/info'),
    ('unlisted','GET','http://denied.invalid/'),
]:
    connection=http.client.HTTPConnection('127.0.0.1',3128,timeout=5)
    try:
        connection.request(method,target)
        response=connection.getresponse()
        statuses[name]=response.status
        response.read(1024)
    except OSError:
        statuses[name]='unreachable'
    finally:
        connection.close()
try:
    with socket.create_connection(('1.1.1.1',443),timeout=1):
        direct=False
except OSError:
    direct=True
canary_path=Path('/tmp/output-canary')
canary=canary_path.read_text() if canary_path.exists() else None
if mode=='secret_diff' and canary:
    Path('/home/agentprobe/workspace/credential.txt').write_text(canary)
print(json.dumps({
    'uid':os.getuid(), 'proxy':statuses, 'direct_blocked':direct,
    'interfaces':{p.name:{'type':int((p/'type').read_text()),
                          'state':(p/'operstate').read_text().strip()}
                  for p in Path('/sys/class/net').iterdir()},
    'other_workspace_absent':not Path(other_marker).exists(),
    'session_credential_readable':bool(keys),
    'credential_canaries':sorted(keys)+([canary] if canary else []),
}))
"""


def require(value, code):
    if not value:
        raise RuntimeError(code)


def fixture(sb, run_id, mode, other_marker):
    sb.exec(
        "python3",
        "-c",
        "import os,signal;from pathlib import Path;"
        "[(os.kill(int(p.name),signal.SIGTERM)) for p in Path('/proc').iterdir() "
        "if p.name.isdigit() and (p/'cmdline').exists() "
        "and b'/opt/agent-platform/guest_fixture.py' "
        "in (p/'cmdline').read_bytes().split(bytes([0]))]",
        timeout=15,
    )
    sb.write_file("/tmp/security_probe.py", GUEST.encode(), mode=0o644)
    prefix = f"python3 /tmp/security_probe.py {mode} {other_marker}; "
    source = (
        Path("src/agent_platform/guest_fixture.py")
        .read_text()
        .replace("class Handler(", "COMMAND = " + repr(prefix) + " + COMMAND\n\nclass Handler(")
    )
    sb.write_file("/opt/agent-platform/security_fixture.py", source.encode(), mode=0o644)
    sb.spawn(
        "python3",
        "-I",
        "/opt/agent-platform/security_fixture.py",
        user="agentcontrol",
        cwd="/var/lib/agent-platform/control",
        env={"FIXTURE_RUN_ID": run_id},
    )
    sb.exec(
        "python3",
        "-c",
        "import socket,time\nfor _ in range(50):\n try:\n"
        "  s=socket.create_connection(('127.0.0.1',18080),.2);s.close();break\n"
        " except OSError: time.sleep(.1)\nelse: raise RuntimeError('fixture_not_ready')\n",
        timeout=15,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(private_file(args.config).read_text())
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    service = Connector(config)
    require(not service.client.sandboxes() and not service.host.vms(), "node_must_be_empty")
    require(all(p["target"] == 0 for p in service.client.info()["pools"]), "warm_pool_not_zero")
    ids = [str(uuid4()), str(uuid4())]
    done, renew_errors = threading.Event(), []

    def renew():
        try:
            while not done.is_set():
                for run_id in ids:
                    service.fences.grant(
                        run_id,
                        Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=30)),
                    )
                done.wait(5)
        except Exception:
            renew_errors.append(True)

    renewer = threading.Thread(target=renew, daemon=True)
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "transport": "cocoon-kvm-product-connector-output",
        "template": config["template"],
        "cases": [],
        "full_at07_complete": False,
        "passed": False,
    }
    try:
        for run_id in ids:
            service.fences.grant(
                run_id, Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=30))
            )
        renewer.start()
        repo = config["repositories"][0]
        for run_id in ids:
            service.allocate(
                run_id,
                Allocate(
                    generation=1,
                    template=config["template"],
                    canonical_repo=repo["canonical_repo"],
                    base_sha=repo["base_sha"],
                    deadline=datetime.now(UTC) + timedelta(seconds=240),
                ),
            )
            service.mutate(run_id, Mutation(generation=1, action="prepare"))
            sb = service.handle(service.journal.read(run_id))
            sb.exec(
                "python3",
                "-c",
                "from pathlib import Path;Path("
                + repr("/home/agentprobe/workspace/" + run_id)
                + ").write_text('isolated')",
                user="agentprobe",
                timeout=10,
            )
        require(len(service.host.vms()) == 2, "two_real_vms_required")
        for n, mode in enumerate(("safe", "secret_diff")):
            run_id, other_id = ids[n], ids[1 - n]
            row = service.journal.read(run_id)
            sb = service.handle(row)
            marker = "/home/agentprobe/workspace/" + other_id
            fixture(sb, run_id, mode, marker)
            # Private diagnostic response: discard credential values before evidence.
            probe = json.loads(
                sb.exec(
                    "python3", "/tmp/security_probe.py", mode, marker, user="agentprobe", timeout=45
                )
            )
            require(
                probe.pop("credential_canaries") == [],
                "guest_control_credential_exposed",
            )
            require(probe["uid"] == 2000, "terminal_account_changed")
            interfaces = probe["interfaces"]
            require(interfaces.get("lo", {}).get("type") == 772, "loopback_missing")
            # Linux may create a dormant SIT tunnel even on a VM with no NIC.
            require(set(interfaces) <= {"lo", "sit0"}, "unexpected_guest_nic")
            if "sit0" in interfaces:
                require(
                    interfaces["sit0"] == {"type": 776, "state": "down"}, "unexpected_guest_tunnel"
                )
            require(probe["direct_blocked"], "direct_egress_allowed")
            require(probe["other_workspace_absent"], "cross_vm_workspace_visible")
            require(
                all(s in (403, "unreachable") for s in probe["proxy"].values()),
                "proxy_egress_allowed",
            )
            # Test-only disclosure after the clean isolation measurement.
            sb.write_file("/tmp/output-canary", row["session_key"].encode(), mode=0o644)
            service.mutate(run_id, Mutation(generation=1, action="prompt", goal="AT-07 fixture"))
            cursor, history = None, []
            deadline = time.monotonic() + 90
            while True:
                events = service.events(run_id, 1, cursor)
                require(not OutputPolicy(service, row).sensitive(events), "secret_escaped_events")
                history.extend(events["events"])
                if events["events"]:
                    cursor = events["events"][-1]["cursor"]
                if events["state"] == "finished" and events["caught_up"]:
                    break
                require(time.monotonic() < deadline, "agent_did_not_finish")
                time.sleep(0.2)
            require("[redacted]" in json.dumps(history), "terminal_canary_not_redacted")
            if mode == "safe":
                value = service.mutate(run_id, Mutation(generation=1, action="result"))
                require(value["verification"]["status"] == "passed", "fixture_verification_failed")
                require(not OutputPolicy(service, row).sensitive(value), "secret_escaped_result")
                result_status = "validated"
            else:
                try:
                    service.mutate(run_id, Mutation(generation=1, action="result"))
                except Problem as exc:
                    require(exc.code == "backend_sensitive_result", "unexpected_result_error")
                else:
                    raise RuntimeError("secret_patch_was_accepted")
                operation = service.journal.read(run_id)["operations"]["result"]
                require(
                    operation["state"] == "started" and "result" not in operation,
                    "rejected_patch_saved_to_journal",
                )
                result_status = "rejected_without_receipt"
            report["cases"].append(
                {"case": mode, "probe": probe, "events_redacted": True, "result": result_status}
            )
            print("KVM output case passed: " + mode, flush=True)
        require(not renew_errors, "lease_renewal_failed")
        report["passed"] = True
    finally:
        accepted, report["passed"] = report["passed"], False
        cleanup = []
        try:
            for run_id in ids:
                service.fences.grant(
                    run_id,
                    Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=30)),
                )
                try:
                    proof = service.cancel(run_id, 1)
                    cleanup.append(proof.get("observed_state") == "not_allocated" or stopped(proof))
                except Exception:
                    cleanup.append(
                        False
                    )  # Still attempt the other owned VM; no raw upstream errors.
            report["cleanup_confirmed"] = all(cleanup)
            report["remaining_claims"] = len(service.client.sandboxes())
            report["remaining_vms"] = len(service.host.vms())
            require(
                report["cleanup_confirmed"]
                and report["remaining_claims"] == 0
                and report["remaining_vms"] == 0,
                "cleanup_incomplete",
            )
            report["passed"] = accepted
        finally:
            done.set()
            if renewer.ident:
                renewer.join(timeout=10)
            service.close()
            report["finished_at"] = datetime.now(UTC).isoformat()
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
