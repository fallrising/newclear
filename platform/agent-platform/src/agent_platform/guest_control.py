"""Trusted guest setup/attestation; invoked as root with Python isolated mode.

The Agent Server is a guest control service. Only the fixed launcher admits a
terminal, with no root or host shell fallback. The SDK workspace is private so
repository plugins/hooks/imports cannot execute with the control identity.
"""

import grp
import hashlib
import json
import os
import pwd
import resource
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path("/var/lib/agent-platform")
CONTROL = ROOT / "control"
CODE = Path("/opt/agent-platform")
REVISION = "guest-control-v1"
DIRECTORIES = [CONTROL, *[CONTROL / n for n in ("home", "workspace", "state", "tmp")]]


def require(value):
    if not value:
        raise RuntimeError("guest_isolation_unconfirmed")


def check_path(path, mode, uid=0, gid=None):
    info = path.lstat()
    require(not path.is_symlink() and info.st_uid == uid and stat.S_IMODE(info.st_mode) == mode)
    require(gid is None or info.st_gid == gid)
    return info


def main():
    request = json.loads(sys.argv[1])
    expected_uid = 2001 if request["action"] == "serve" else 0
    require(os.getuid() == expected_uid and os.geteuid() == expected_uid)
    os.umask(0o077)
    if request["action"] == "setup":
        try:
            account = pwd.getpwnam("agentcontrol")
        except KeyError:
            subprocess.run(["groupadd", "--gid", "2001", "agentcontrol"], check=True)
            subprocess.run(
                [
                    "useradd",
                    "--uid",
                    "2001",
                    "--gid",
                    "2001",
                    "--no-create-home",
                    "--home-dir",
                    str(CONTROL / "home"),
                    "--shell",
                    "/usr/sbin/nologin",
                    "agentcontrol",
                ],
                check=True,
            )
            account = pwd.getpwnam("agentcontrol")
        require(account.pw_uid == 2001 and account.pw_gid == 2001)
        require(grp.getgrnam("agentcontrol").gr_gid == 2001)
        ROOT.mkdir(mode=0o755, exist_ok=True)
        require(not ROOT.is_symlink())
        ROOT.chmod(0o755)
        require(stat.S_ISDIR(check_path(ROOT, 0o755).st_mode))
        for path in DIRECTORIES:
            path.mkdir(mode=0o700, exist_ok=True)
            require(not path.is_symlink())
            os.chown(path, 2001, 2001, follow_symlinks=False)
            require(stat.S_ISDIR(check_path(path, 0o700, 2001, 2001).st_mode))
        print(json.dumps({"revision": REVISION}))
        return
    require(stat.S_ISDIR(check_path(ROOT, 0o755).st_mode))
    for path in DIRECTORIES:
        require(stat.S_ISDIR(check_path(path, 0o700, 2001, 2001).st_mode))
    if request["action"] == "serve":
        environment = {
            "SESSION_API_KEY": os.environ["SESSION_API_KEY"],
            "OPENHANDS_BUILD_GIT_SHA": os.environ["OPENHANDS_BUILD_GIT_SHA"],
            "HOME": str(CONTROL / "home"),
            "TMPDIR": str(CONTROL / "tmp"),
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "LANG": "C.UTF-8",
            "OH_CONVERSATIONS_PATH": str(CONTROL / "state/conversations"),
            "OH_BASH_EVENTS_DIR": str(CONTROL / "state/bash-events"),
            "OPENHANDS_AGENT_SERVER_CONFIG_PATH": str(CONTROL / "state/config.json"),
        }
        os.chdir(CONTROL)
        os.execve(
            "/usr/local/bin/openhands-agent-server",
            ["/usr/local/bin/openhands-agent-server", "--host", "127.0.0.1", "--port", "8000"],
            environment,
        )
    require(request["action"] == "check")
    interfaces = {p.name for p in Path("/sys/class/net").iterdir()}
    require("lo" in interfaces and interfaces <= {"lo", "sit0"})
    if "sit0" in interfaces:
        require(int(Path("/sys/class/net/sit0/flags").read_text(), 16) & 1 == 0)
    require(stat.S_ISDIR(check_path(CODE, 0o755).st_mode))
    for name, expected in request["files"].items():
        require(
            name
            in {
                "terminal",
                "guest_control.py",
                "guest_quiescence.py",
                "guest_workspace.py",
                "guest_fixture.py",
                "guest_model.py",
            }
        )
        path = CODE / name
        mode = 0o4750 if name == "terminal" else 0o644
        require(stat.S_ISREG(check_path(path, mode, gid=2001 if name == "terminal" else 0).st_mode))
        require(hashlib.sha256(path.read_bytes()).hexdigest() == expected)
    controls, terminals = [], []
    for path in Path("/proc").glob("[0-9]*"):
        try:
            arguments = (path / "cmdline").read_bytes().split(bytes([0]))
            status = dict(line.split(":", 1) for line in (path / "status").read_text().splitlines())
            if b"/usr/local/bin/openhands-agent-server" in arguments:
                require(status["Uid"].split() == ["2001"] * 4)
                require(status["Gid"].split() == ["2001"] * 4)
                require(int(status["CapEff"], 16) == 0)
                controls.append(int(path.name))
            # proc inode ownership can become root when a process disables dumping.
            if status["Uid"].split()[0] == "2000" and status["State"].strip()[0] != "Z":
                require(status["Uid"].split() == ["2000"] * 4)
                require(status["Gid"].split() == ["2000"] * 4)
                require(not status["Groups"].strip())
                require(int(status["CapEff"], 16) == 0 and int(status["CapPrm"], 16) == 0)
                require(status["NoNewPrivs"].strip() == "1")
                terminals.append(int(path.name))
        except FileNotFoundError:
            # A racing process is not proof of a stable security boundary.
            raise RuntimeError("guest_isolation_unstable") from None
    require(bool(controls))
    if request.get("terminal"):
        require(bool(terminals))
    print(
        json.dumps(
            {
                "revision": REVISION,
                "control_uid": 2001,
                "terminal_uid": 2000,
                "no_new_privileges": True,
                "private_workspace": True,
            }
        )
    )


if __name__ == "__main__":
    # Control process cannot dump credentials to a guest-readable core file.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    main()
