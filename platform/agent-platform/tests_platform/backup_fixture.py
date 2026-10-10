"""Actual native clients on an owned container, including hosted PostgreSQL services."""

import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

from psycopg.conninfo import conninfo_to_dict

IMAGE = "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873"


class NativeClient:
    def __init__(self, url):
        self.name = "agent-platform-backup-client-" + uuid4().hex[:12]
        self.created = False
        config = conninfo_to_dict(url)
        with tempfile.TemporaryDirectory(prefix="backup-native-fixture-") as root:
            envfile = Path(root) / "client.env"
            envfile.write_text(
                "\n".join(
                    "PG" + key.upper() + "=" + config[key]
                    for key in ("host", "port", "user", "password", "dbname")
                    if key in config
                ).replace("PGDBNAME=", "PGDATABASE=")
                + "\n"
            )
            envfile.chmod(0o600)
            subprocess.run(
                [
                    "docker",
                    "run",
                    "--detach",
                    "--network",
                    "host",
                    "--name",
                    self.name,
                    "--label",
                    "newclear.agent-platform=backup-native-client",
                    "--env-file",
                    str(envfile),
                    "--memory=256m",
                    "--pids-limit=64",
                    "--entrypoint",
                    "sleep",
                    IMAGE,
                    "1800",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=60,
            )
            self.created = True

    def close(self):
        if not self.created:
            return
        label = subprocess.check_output(
            [
                "docker",
                "inspect",
                "--format",
                '{{index .Config.Labels "newclear.agent-platform"}}',
                self.name,
            ],
            text=True,
            timeout=15,
        ).strip()
        if label != "backup-native-client":
            raise RuntimeError("Native fixture ownership changed")
        subprocess.run(
            ["docker", "rm", "--force", self.name],
            check=True,
            stdout=subprocess.DEVNULL,
            timeout=20,
        )
        self.created = False

    def run(self, program, arguments, *, connection, stdin=None, stdout=None):
        database = conninfo_to_dict(connection)["dbname"]
        result = subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                "--env",
                "PGDATABASE=" + database,
                self.name,
                program,
                *arguments,
            ],
            stdin=stdin,
            stdout=stdout if stdout is not None else subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=120,
            check=True,
        )
        return result.stdout or b""
