"""Opt-in host-local M0 evidence: real claims, isolation, TTL and observed VM removal.

Run only against a dedicated, empty, zero-warm sandboxd node. Credentials are
read from the environment; the local Cocoon config and usage journal must
belong to that same node. This runner never declares the entire M0 complete.
"""

import argparse
import json
import os
import secrets
import subprocess
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from cocoonsandbox import APIError

from .sandbox_client import SingleNodeClient
from .sandbox_smoke import Config
from .sandbox_smoke import run as sandbox_probe
from .transport import ProbeError


def require(condition, reason):
    if not condition:
        raise ProbeError(reason)


def process_identity(pid):
    """PID alone is insufficient when the kernel reuses a process number."""
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return {"pid": pid, "start_ticks": int(fields[19]), "state": fields[0]}
    except FileNotFoundError:
        return None


class Host:
    def __init__(self, config_path, data_dir):
        self.config_path = config_path
        self.config = json.loads(config_path.read_text())
        self.data_dir = data_dir
        self.cgroup = Path("/sys/fs/cgroup") / self.config["cgroup_parent"]

    def vms(self):
        result = subprocess.run(
            ["cocoon", "--config", str(self.config_path), "vm", "list", "--format", "json"],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
        rows = json.loads(result.stdout)
        require(isinstance(rows, list), "invalid_vm_list")
        return rows

    def observe(self, sandbox_id):
        claims = [
            json.loads(line) for line in (self.data_dir / "usage.jsonl").read_text().splitlines()
        ]
        names = {r["vm"] for r in claims if r.get("ev") == "claim" and r.get("id") == sandbox_id}
        require(len(names) == 1, "claim_vm_mapping_not_unique")
        matches = [v for v in self.vms() if v["config"]["name"] in names]
        require(len(matches) == 1, "host_vm_not_unique")
        vm = matches[0]
        identity = process_identity(vm["pid"])
        require(identity is not None and identity["state"] != "Z", "vmm_not_live")
        cmdline = Path(f"/proc/{vm['pid']}/cmdline").read_bytes().split(b"\0")
        require(Path(os.fsdecode(cmdline[0])).name == "cloud-hypervisor", "not_vmm")
        require(vm["socket_path"].encode() in cmdline, "vmm_socket_mismatch")
        scope = self.cgroup / f"vm-{vm['id']}.scope"
        require(
            str(vm["pid"]) in (scope / "cgroup.procs").read_text().split(), "vmm_scope_mismatch"
        )
        quota, period = (scope / "cpu.max").read_text().split()
        require(int(quota) == vm["config"]["cpu"] * int(period), "cpu_quota_mismatch")
        return {
            "sandbox_id": sandbox_id,
            "vm_id": vm["id"],
            "vm_name": vm["config"]["name"],
            "identity": identity,
            "state": vm["state"],
            "image_digest": vm["config"]["image_digest"],
            "cpu": vm["config"]["cpu"],
            "memory_bytes": vm["config"]["memory"],
            "cpu_max": f"{quota} {period}",
            "run_dir": str(Path(vm["socket_path"]).parent),
            "scope": str(scope),
        }

    def removal(self, observed):
        identity = process_identity(observed["identity"]["pid"])
        original_alive = (
            identity is not None and identity["start_ticks"] == observed["identity"]["start_ticks"]
        )
        return {
            "original_vmm_process_gone": not original_alive,
            "vm_record_gone": not any(v["id"] == observed["vm_id"] for v in self.vms()),
            "runtime_directory_gone": not Path(observed["run_dir"]).exists(),
            "cpu_scope_gone": not Path(observed["scope"]).exists(),
        }

    def wait_removed(self, observed, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = self.removal(observed)
            if all(result.values()):
                return result
            time.sleep(0.25)
        raise ProbeError("host_vm_removal_unconfirmed")


def run(args):
    config = Config(args.origin, args.template)
    config.validate()
    token = os.environ[args.token_env]
    client = SingleNodeClient(args.origin, token)
    host = Host(args.cocoon_config, args.sandbox_data_dir)
    require(not client.sandboxes() and not host.vms(), "dedicated_node_must_be_empty")
    require(all(p["target"] == 0 for p in client.info()["pools"]), "warm_pool_not_zero")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "template": args.template,
        "transport": "cocoon-kvm-host-local",
        "checks": {},
        "observations": [],
        "full_m0_complete": False,
    }
    handles = []
    issued_refs = set()

    def check(name, evidence=True):
        report["checks"][name] = {"status": "passed", "evidence": evidence}
        print(name + ": passed", flush=True)

    def claim(ttl=180):
        ref = "m0-live-" + uuid.uuid4().hex
        issued_refs.add(ref)
        sb = client.new(args.template, net="none", size="large", ttl_seconds=ttl, claim_ref=ref)
        handles.append(sb)
        observed = host.observe(sb.id)
        require(observed["image_digest"] == args.template.split("@", 1)[1], "wrong_oci_digest")
        report["observations"].append(observed)
        return sb, observed

    def release(sb, observed):
        sb.close()
        sb.close()
        require(not any(row["id"] == sb.id for row in client.sandboxes()), "claim_still_listed")
        return host.wait_removed(observed)

    try:
        first, first_vm = claim()
        second, second_vm = claim()
        require(first_vm["vm_id"] != second_vm["vm_id"], "same_vm_for_two_claims")
        require(len(host.vms()) == 2, "two_vms_not_running")
        for sb, observed in [(first, first_vm), (second, second_vm)]:
            guest = json.loads(
                sb.exec(
                    "python3",
                    "-c",
                    "import json,os;from pathlib import Path;"
                    "print(json.dumps({'cpus':os.cpu_count(),"
                    "'mem_kib':int(Path('/proc/meminfo').read_text().splitlines()[0].split()[1]),"
                    "'interfaces':os.listdir('/sys/class/net')}))",
                    timeout=15,
                )
            )
            require(guest["cpus"] == observed["cpu"] == 4, "guest_cpu_mismatch")
            require(observed["memory_bytes"] == 4 * 1024**3, "host_memory_mismatch")
            require(3.5 * 1024**2 < guest["mem_kib"] < 4 * 1024**2, "guest_memory_mismatch")
            require(set(guest["interfaces"]) <= {"lo", "sit0"}, "unexpected_guest_nic")
            observed["guest"] = guest
        check("two_real_guests_and_resource_limits")

        filename = "/home/agentprobe/m0-isolation.txt"
        first.write_file(filename, b"first-workspace")
        second.write_file(filename, b"second-workspace")
        require(first.read_file(filename) == b"first-workspace", "first_workspace_overwritten")
        require(second.read_file(filename) == b"second-workspace", "second_workspace_overwritten")
        marker = args.output.resolve() / "host-canary"
        marker.write_text(secrets.token_urlsafe(32))
        try:
            for sb in (first, second):
                absent = sb.exec(
                    "python3",
                    "-c",
                    "from pathlib import Path;import sys;"
                    "assert not Path(sys.argv[1]).exists();"
                    "assert not Path('/var/run/docker.sock').exists()",
                    str(marker),
                    timeout=15,
                )
                require(absent == "", "unexpected_guest_output")
        finally:
            marker.unlink()
        check("workspace_and_host_mount_isolation")
        wrong = client.attach(second.owner, second.id, first.token)
        try:
            wrong.exec("true", timeout=5)
        except APIError as exc:
            require(exc.status in {401, 403, 404}, "unexpected_auth_status")
        else:
            raise ProbeError("sibling_token_accepted")
        check("sibling_sandbox_token_rejected")

        pid = first.spawn("python3", "-c", "import time;time.sleep(120)", user="agentprobe")
        require(
            any(p["pid"] == pid and p["state"] == "running" for p in first.ps()),
            "long_process_not_running",
        )
        check("release_terminates_busy_vm", release(first, first_vm))
        require(second.read_file(filename) == b"second-workspace", "sibling_lost_after_release")
        check("sibling_survives_other_release")
        check("second_vm_resources_removed", release(second, second_vm))

        ttl_sb, ttl_vm = claim(ttl=20)
        expires = datetime.fromisoformat(ttl_sb.deadline.replace("Z", "+00:00"))
        time.sleep(3)
        require(datetime.now(UTC) < expires, "ttl_already_elapsed")
        require(ttl_sb.exec("true", timeout=5) == "", "guest_not_live_before_ttl")
        check("ttl_guest_live_before_deadline", {"deadline": ttl_sb.deadline})
        deadline = time.monotonic() + 40
        while any(row["id"] == ttl_sb.id for row in client.sandboxes()):
            require(time.monotonic() < deadline, "ttl_not_reaped")
            time.sleep(0.5)
        require(datetime.now(UTC) >= expires, "claim_removed_before_deadline")
        check("ttl_expiry_stops_vm_and_reclaims_resources", host.wait_removed(ttl_vm))
        ttl_sb.close()

        class LoseReply(SingleNodeClient):
            allocations = 0

            def _post_json(self, addr, path, body, verb, *, deadline=None):
                reply = super()._post_json(addr, path, body, verb, deadline=deadline)
                if path == "/v1/claim":
                    self.allocations += 1
                    issued_refs.add(body["claim_ref"])
                    raise TimeoutError("injected_after_real_allocation")
                return reply

        lossy = LoseReply(args.origin, token)
        ambiguous = sandbox_probe(
            config, token, args.output / "lost-claim-reply", client_factory=lambda *_: lossy
        )
        require(lossy.allocations == 1, "allocation_retried")
        require(
            ambiguous["sandbox_contract_passed"] is False, "uncertain_allocation_claimed_success"
        )
        require(
            ambiguous["checks"]["allocation_reconciliation"] == "operator_required",
            "missing_reconciliation",
        )
        matches = [
            row for row in client.sandboxes() if row.get("claim_ref") == ambiguous["claim_ref"]
        ]
        require(len(matches) == 1, "uncertain_claim_not_unique")
        lost_id = matches[0]["id"]
        lost_vm = host.observe(lost_id)
        report["observations"].append(lost_vm)
        client._request(
            client.addr, "POST", f"/v1/sandboxes/{lost_id}/release", None, "operator release"
        )
        check(
            "lost_reply_single_allocation_and_reconciliation",
            {
                "injection": "SDK boundary timeout after real HTTP allocation",
                "allocation_requests": lossy.allocations,
                "removal": host.wait_removed(lost_vm),
            },
        )
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = str(exc) if isinstance(exc, ProbeError) else type(exc).__name__
    finally:
        cleanup_errors = []
        for sb in handles:
            try:
                sb.close()
            except Exception:
                cleanup_errors.append(sb.id)
        try:
            for row in client.sandboxes():
                if row.get("claim_ref") in issued_refs:
                    client._request(
                        client.addr,
                        "POST",
                        f"/v1/sandboxes/{row['id']}/release",
                        None,
                        "operator cleanup",
                    )
            for observed in report["observations"]:
                host.wait_removed(observed)
            require(not host.vms(), "host_vm_residue")
        except Exception:
            cleanup_errors.append("host_or_claim_cleanup_unconfirmed")
        report["cleanup_errors"] = cleanup_errors
        report["lifecycle_passed"] = not report.get("error") and not cleanup_errors
        report["finished_at"] = datetime.now(UTC).isoformat()
        fd = os.open(args.output / "report.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--template", required=True)
    parser.add_argument("--cocoon-config", type=Path, required=True)
    parser.add_argument("--sandbox-data-dir", type=Path, required=True)
    parser.add_argument("--token-env", default="SANDBOX_API_TOKEN")
    parser.add_argument("--output", type=Path, required=True)
    report = run(parser.parse_args())
    print(json.dumps(report, indent=2))
    return 0 if report["lifecycle_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
