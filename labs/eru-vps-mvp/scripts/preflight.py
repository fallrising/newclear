#!/usr/bin/env python3
"""Collect read-only ERU readiness evidence via controller SSH aliases.

No installation, runtime mutations, firewall changes or secret-file reads.
The sudo commands are fixed diagnostic operations in the existing hostctl.
Raw results may contain addresses; keep output outside public version control.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile

HOSTS = tuple(f"disposable-{i:02d}" for i in range(1, 5))
REMOTE = r'''
import json, os, shutil, subprocess
from pathlib import Path
out = {}
for key, command in {
    "hostname": ["hostname"],
    "whoami": ["whoami"],
    "kernel": ["uname", "-a"],
    "containerd_version": ["containerd", "--version"],
    "runc_version": ["runc", "--version"],
    "docker_version": ["docker", "--version"],
    "docker_workloads": ["docker", "ps", "--format", "{{.Names}} | {{.Image}} | {{.Status}}"],
    "identity": ["id"],
    "addresses": ["ip", "-j", "address", "show"],
    "routes": ["ip", "-j", "route", "show"],
    "runtime_units": ["systemctl", "show", "docker", "containerd", "-p", "Id", "-p", "FragmentPath", "-p", "ExecStart"],
    "listeners": ["ss", "-H", "-lntu"],
    "sudo_permissions": ["sudo", "-n", "-l"],
    "access_status": ["sudo", "-n", "/usr/local/sbin/onevps-hostctl", "access-status"],
    "baseline_preflight": ["sudo", "-n", "/usr/local/sbin/onevps-hostctl", "baseline-preflight"],
}.items():
    try:
        p = subprocess.run(command, capture_output=True, text=True, timeout=25)
        out[key] = {"command": command, "exit_code": p.returncode,
                    "stdout": p.stdout.strip(), "stderr": p.stderr.strip()}
    except (OSError, subprocess.TimeoutExpired) as e:
        out[key] = {"command": command, "error": str(e)}
out["os_release"] = Path("/etc/os-release").read_text()
out["cpu_count"] = os.cpu_count()
out["memory"] = {line.split(":")[0]: line.split(":",1)[1].strip()
                 for line in Path("/proc/meminfo").read_text().splitlines()
                 if line.startswith(("MemTotal:", "MemAvailable:", "SwapTotal:"))}
s = os.statvfs("/")
out["disk_gib"] = {"total": round(s.f_blocks*s.f_frsize/2**30, 2),
                   "available": round(s.f_bavail*s.f_frsize/2**30, 2)}
out["binaries"] = {x: shutil.which(x) for x in
    ["python3", "eru-cli", "eru-core", "eru-agent", "etcd", "etcdctl", "etcdutl", "containerd", "runc", "tailscale"]}
out["cgroup_v2"] = Path("/sys/fs/cgroup/cgroup.controllers").exists()
try:
    p = subprocess.run(["tailscale", "status", "--json"], capture_output=True, text=True, timeout=10)
    if p.returncode == 0:
        d = json.loads(p.stdout)
        out["tailscale"] = {k: d.get(k) for k in ["BackendState", "TailscaleIPs", "Health"]}
        out["tailscale"]["self_online"] = d.get("Self", {}).get("Online")
        out["tailscale"]["peer_count"] = len(d.get("Peer") or {})
    else:
        out["tailscale"] = {"exit_code": p.returncode, "stderr": p.stderr.strip()}
except (OSError, ValueError, subprocess.TimeoutExpired) as e:
    out["tailscale"] = {"error": str(e)}
print(json.dumps(out))
'''


def collect(host):
    command = ["ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
               "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1",
               "-o", "PermitLocalCommand=no", host, "python3 -"]
    try:
        p = subprocess.run(command, input=REMOTE, capture_output=True, text=True, timeout=120)
        result = {"host": host, "ssh_command": command, "exit_code": p.returncode,
                  "stderr": p.stderr.strip()}
        if p.returncode == 0:
            result["checks"] = json.loads(p.stdout)
        else:
            result["stdout"] = p.stdout.strip()
        return result
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        return {"host": host, "ssh_command": command, "error": str(e)}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output-dir", required=True, type=Path, help="Private evidence directory")
    ap.add_argument("--host", action="append", choices=HOSTS, help="Default: all four, sequentially")
    args = ap.parse_args()
    os.umask(0o077)
    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    failed = False
    for host in args.host or HOSTS:
        print(f"[{host}] SSH python3 -: runtime/network facts, sudo -n -l, hostctl access-status, hostctl baseline-preflight", flush=True)
        result = collect(host)
        result["collected_at"] = datetime.now(timezone.utc).isoformat()
        # Exclusive creation avoids overwriting an earlier evidence record.
        with tempfile.NamedTemporaryFile(mode="w", prefix=f"{stamp}-{host}-", suffix=".json",
                                         dir=args.output_dir, delete=False) as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            f.write("\n")
            saved = f.name
        checks = result.get("checks", {})
        failed |= result.get("exit_code") != 0
        print(json.dumps({"host": host, "transport_ok": result.get("exit_code") == 0,
            "hostname": checks.get("hostname", {}).get("stdout"),
            "cpu_count": checks.get("cpu_count"), "memory": checks.get("memory"),
            "disk_gib": checks.get("disk_gib"),
            "containerd": checks.get("containerd_version", {}).get("stdout"),
            "docker_visibility_exit": checks.get("docker_workloads", {}).get("exit_code"),
            "tailscale": checks.get("tailscale"),
            "access_status": checks.get("access_status"),
            "baseline_preflight": checks.get("baseline_preflight"),
            "evidence": saved}, ensure_ascii=False), flush=True)
    # This is collection success, not a deployment readiness assertion.
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
