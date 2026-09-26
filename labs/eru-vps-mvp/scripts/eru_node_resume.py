"""Wait for a newly added, fenced worker to report ready before bringing it up."""
import ipaddress
import json
import re
import subprocess
import time


def _read_node(core_ip, name, endpoint, runner):
    argv = ["sudo", "-n", "/usr/local/bin/eru-cli", "--eru", core_ip + ":5001",
            "--output", "json", "node", "get", name]
    result = runner(argv, capture_output=True, text=True, timeout=30, check=False)
    if result.returncode:
        raise ValueError("core could not read the newly registered worker")
    try:
        payload = json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError("core returned invalid JSON for the newly registered worker") from exc
    rows = [payload] if isinstance(payload, dict) else payload if isinstance(payload, list) else []
    rows = [row for row in rows if isinstance(row, dict) and row.get("name") == name]
    if len(rows) != 1 or rows[0].get("endpoint") != endpoint:
        raise ValueError("core worker identity or endpoint differs from the registration plan")
    row = rows[0]
    if type(row.get("available")) is not bool or type(row.get("bypass")) is not bool:
        raise ValueError("core worker liveness or fence state is unreadable")
    return row


def resume_registered_worker(core_ip, name, endpoint, *, runner=subprocess.run,
                             sleep=time.sleep, attempts=60, interval=1):
    """Require Bypass, wait for a live agent, then explicitly resume this new node."""
    try:
        address = ipaddress.ip_address(core_ip)
    except ValueError as exc:
        raise ValueError("core endpoint must be an IP address") from exc
    if address.version != 4 or address not in ipaddress.ip_network("100.64.0.0/10"):
        raise ValueError("core endpoint must be a Tailscale IPv4 address")
    if not isinstance(name, str) or not re.fullmatch(r"worker-[234]", name):
        raise ValueError("only a reviewed worker node can be resumed")
    match = re.fullmatch(r"containerd://ckc@([^:]+):22", endpoint) if isinstance(endpoint, str) else None
    if not match:
        raise ValueError("worker endpoint must use the reviewed ckc containerd tunnel")
    try:
        worker_address = ipaddress.ip_address(match.group(1))
    except ValueError as exc:
        raise ValueError("worker endpoint must contain a valid Tailscale IPv4 address") from exc
    if worker_address.version != 4 or worker_address not in ipaddress.ip_network("100.64.0.0/10"):
        raise ValueError("worker endpoint must use a Tailscale IPv4 address")
    if type(attempts) is not int or attempts < 1 or type(interval) not in (int, float) or interval < 0:
        raise ValueError("readiness polling bounds are invalid")

    ready = None
    for attempt in range(attempts):
        row = _read_node(core_ip, name, endpoint, runner)
        if row["bypass"] is not True:
            raise ValueError("new worker lost its scheduling fence before readiness")
        if row["available"] is True:
            ready = row
            break
        if attempt + 1 < attempts:
            sleep(interval)
    if ready is None:
        raise ValueError("new worker agent did not report ready while fenced")

    argv = ["sudo", "-n", "/usr/local/bin/eru-cli", "--eru", core_ip + ":5001",
            "node", "up", name]
    result = runner(argv, capture_output=True, text=True, timeout=30, check=False)
    if result.returncode:
        raise ValueError("core did not confirm explicit worker resume")

    row = _read_node(core_ip, name, endpoint, runner)
    if row["available"] is not True or row["bypass"] is not False:
        raise ValueError("worker resume outcome is uncertain; inspect core state before retrying")
    return {"node": name, "status": "resumed", "available": True, "bypass": False}


def main():
    raise SystemExit("Use scripts/labctl.py resume-reimage-worker with a reviewed hash-bound plan")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as exc:
        raise SystemExit("ERROR: " + str(exc))
