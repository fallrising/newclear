"""Start/attest the pinned sandboxd with a sealed, immutable Linux memfd config.

Only this fixed runtime executable is launched; no task command or host shell.
An on-disk config inspection alone cannot establish what a daemon loaded.
"""

import argparse
import fcntl
import hashlib
import json
import os
import socket
import stat
from pathlib import Path
from uuid import uuid4

from agent_platform_m0.kvm_lifecycle import Host, process_identity

from .connector_journal import Journal, private_file
from .connector_recovery import stopped
from .domain import Problem
from .egress_policy import REVISION, SANDBOXD_SHA256, require, validate_node

BINARY = "/usr/local/bin/sandboxd"
SEALS = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL


def sealed_config(data):
    fd = os.memfd_create("agent-platform-egress", os.MFD_ALLOW_SEALING)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(os.dup(fd), "wb") as stream:
            stream.write(data)
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, SEALS)
        os.set_inheritable(fd, True)
        return fd
    except BaseException:
        os.close(fd)
        raise


def identity(pid):
    value = process_identity(pid)
    require(value is not None and value["state"] != "Z", "egress_node_not_live")
    return {
        "pid": pid,
        "start_ticks": value["start_ticks"],
        "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
    }


def owns_listener(pid, port):
    sockets = set()
    for fd in Path(f"/proc/{pid}/fd").iterdir():
        try:
            link = os.readlink(fd)
        except FileNotFoundError:
            continue
        if link.startswith("socket:["):
            sockets.add(link[8:-1])
    target = f"0100007F:{port:04X}"
    return any(
        fields[1] == target and fields[3] == "0A" and fields[9] in sockets
        for line in Path(f"/proc/{pid}/net/tcp").read_text().splitlines()[1:]
        if len(fields := line.split()) >= 10
    )


def attest(config, row=None):
    """Read live sealed config + executable + listening socket, never return secrets."""
    try:
        receipt = json.loads(private_file(config["egress_receipt_file"]).read_text())
        require(receipt["revision"] == REVISION, "egress_node_revision_mismatch")
        pid, fd = receipt["identity"]["pid"], receipt["config_fd"]
        require(type(pid) is int and pid > 0 and type(fd) is int and fd >= 3)
        observed = identity(pid)
        require(observed == receipt["identity"], "egress_node_identity_changed")
        process = Path(f"/proc/{pid}")
        require(process.stat().st_uid == os.getuid(), "egress_node_owner_mismatch")
        require(
            hashlib.sha256((process / "exe").read_bytes()).hexdigest() == SANDBOXD_SHA256,
            "egress_node_binary_mismatch",
        )
        require(
            (process / "cmdline").read_bytes().split(b"\0")
            == [
                BINARY.encode(),
                b"-config",
                f"/proc/self/fd/{fd}".encode(),
                b"",
            ],
            "egress_node_arguments_mismatch",
        )
        with (process / "fd" / str(fd)).open("rb") as stream:
            info = os.fstat(stream.fileno())
            require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600)
            require(fcntl.fcntl(stream, fcntl.F_GET_SEALS) == SEALS, "egress_config_not_sealed")
            raw = stream.read(65537)
        require(len(raw) <= 65536)
        node = json.loads(raw)
        token = private_file(config["sandbox_token_file"]).read_text().strip()
        policy_hash = validate_node(node, config, token)
        require(
            owns_listener(pid, int(config["origin"].rsplit(":", 1)[1])),
            "egress_node_listener_mismatch",
        )
        require(identity(pid) == observed, "egress_node_identity_changed")
        proof = {"revision": REVISION, "identity": observed, "policy_sha256": policy_hash}
        if row is not None:
            require(row.get("egress") == proof, "egress_run_policy_changed")
        return proof
    except Problem:
        raise
    except Exception:
        # Includes missing/legacy config. Never expose decoded node config or OS error text.
        raise Problem(409, "egress_node_unconfirmed") from None


def drained(config, host):
    require(not host.vms(), "egress_policy_change_requires_drain")
    claims = Path(config["sandbox_data_dir"]) / "claims.json"
    require(
        not claims.exists() or json.loads(claims.read_text()) == {},
        "egress_policy_change_requires_drain",
    )
    # A missing claim is insufficient. Preserve uncertain intents/fences for reconciliation.
    with_journal = Journal(config["state_dir"])
    try:
        for path in with_journal.root.glob("*.json"):
            row = json.loads(private_file(path).read_text())
            if row.get("handle"):
                require(bool(row.get("observed")), "egress_allocation_ownership_uncertain")
                require(
                    stopped({"observed_state": "stopped", "proof": host.removal(row["observed"])}),
                    "egress_policy_change_requires_drain",
                )
            else:
                require(
                    "allocate" not in row["operations"], "egress_allocation_ownership_uncertain"
                )
    finally:
        with_journal.close()


def launch(config_path, node_path):
    os.umask(0o077)
    config = json.loads(private_file(config_path).read_text())
    raw = private_file(node_path).read_bytes()
    require(len(raw) <= 65536)
    node = json.loads(raw)
    validate_node(node, config, private_file(config["sandbox_token_file"]).read_text().strip())
    receipt = Path(config["egress_receipt_file"])
    parent = receipt.parent.stat()
    require(
        not receipt.parent.is_symlink()
        and parent.st_uid == os.getuid()
        and not parent.st_mode & 0o077,
        "egress_receipt_directory_not_private",
    )
    # Held across exec; only one managed sandboxd can use this node data directory.
    lock = os.open(
        Path(node["data_dir"]) / "egress-owner.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
    )
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.set_inheritable(lock, True)
    drained(config, Host(Path(config["cocoon_config"]), Path(config["sandbox_data_dir"])))
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", int(config["origin"].rsplit(":", 1)[1])))
    binary = os.open(BINARY, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(os.dup(binary), "rb") as stream:
        require(
            hashlib.sha256(stream.read()).hexdigest() == SANDBOXD_SHA256,
            "egress_node_binary_mismatch",
        )
    fd = sealed_config(raw)
    value = {"revision": REVISION, "identity": identity(os.getpid()), "config_fd": fd}
    temporary = receipt.with_name(receipt.name + "." + uuid4().hex + ".tmp")
    out = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(out, "w") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, receipt)
    # No inherited provider credentials, proxy settings or dynamic-loader environment.
    os.execve(
        binary,
        [BINARY, "-config", f"/proc/self/fd/{fd}"],
        {"PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin", "HOME": os.environ["HOME"]},
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="private connector config")
    parser.add_argument("--sandbox-config", type=Path, required=True)
    args = parser.parse_args()
    try:
        launch(args.config, args.sandbox_config)
    except Problem as exc:
        parser.exit(1, exc.code + "\n")
    except OSError as exc:
        parser.exit(1, "egress_node_start_refused: " + type(exc).__name__ + "\n")
    except Exception:
        # sandboxd's private service log is separate; never print node config exceptions.
        parser.exit(1, "egress_node_start_refused; verify policy, drain and private files\n")


if __name__ == "__main__":
    main()
