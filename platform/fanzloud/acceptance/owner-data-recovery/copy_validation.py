"""Private isolated-copy diagnostic; default prepares only, never starts PostgreSQL."""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tarfile
import time
from pathlib import Path
from uuid import UUID, uuid4

import verify_snapshot as snapshot

WRITER = snapshot.WRITER.decode()
REVIEWER = snapshot.REVIEWER.decode()
IMAGE = (
    "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873"
)
EXPECTED_ARCHIVES = {
    WRITER: ("9faf56d6d8ccb05ce8f6b20e78c728db9de516fb890ae3ab62a0dea2d04468d7", 1747),
    REVIEWER: (
        "745de4e6cbfa5fe3878b186bb8e3e675d3c000b93d7d0ee281d1fc2212d1aabd",
        1923,
    ),
}
DIFF_SHA256 = "c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb"
LIMIT = 2 * 1024**2


class Rejected(Exception):
    """Fixed public reason; never interpolate input or exception text."""


def canonical(value):
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise Rejected("reference_invalid")
    return value


def private_write(path, value):
    with open(
        os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "wb"
    ) as out:
        out.write(value)
        out.flush()
        os.fsync(out.fileno())


def copy_regular(source, target, limit):
    with open(
        os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb"
    ) as src:
        before = os.fstat(src.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise Rejected("input_limit")
        with open(
            os.open(
                target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
            ),
            "wb",
        ) as out:
            size = 0
            while block := src.read(65536):
                size += len(block)
                if size > limit:
                    raise Rejected("input_limit")
                out.write(block)
        after = os.fstat(src.fileno())
        if (
            snapshot._identity(before) != snapshot._identity(after)
            or size != before.st_size
        ):
            raise Rejected("input_changed")


def validate_references(rows):
    try:
        if len(rows) != 4:
            raise ValueError
        keys = set()
        runs = set()
        result = []
        for row in rows:
            row = dict(row)
            for key in ("owner", "key", "run_id"):
                canonical(row[key])
            if (
                row["state"] != "confirmed"
                or row["key"] in keys
                or row["run_id"] in runs
            ):
                raise ValueError
            keys.add(row["key"])
            runs.add(row["run_id"])
            request = row["request"]
            receipt = row["receipt"]
            if set(request) == {"route", "body"}:
                if (
                    request["route"] != f"/api/v1/runs/{WRITER}/reviews"
                    or row["run_id"] != REVIEWER
                ):
                    raise ValueError
                route = f"runs/{WRITER}/reviews"
                payload = request["body"]
                if set(payload) != {
                    "artifact_id",
                    "candidate_sha256",
                    "profile_revision",
                }:
                    raise ValueError
                canonical(payload["artifact_id"])
                canonical(payload["profile_revision"])
                if not re.fullmatch("[a-f0-9]{64}", payload["candidate_sha256"]):
                    raise ValueError
            else:
                if set(request) != {
                    "base_sha",
                    "goal",
                    "profile_revision",
                    "project_id",
                    "title",
                }:
                    raise ValueError
                route = "tasks.create"
                payload = request
            task, run = receipt["task"], receipt["run"]
            if (
                run["id"] != row["run_id"]
                or run["task_id"] != task["id"]
                or task["created_by"] != row["owner"]
            ):
                raise ValueError
            canonical(task["id"])
            row["route"] = route
            row["payload"] = payload
            row["payload_hash"] = hashlib.sha256(
                json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            result.append(row)
        if (
            not {WRITER, REVIEWER}.issubset(runs)
            or sum(r["route"] != "tasks.create" for r in result) != 1
        ):
            raise ValueError
        return result
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        raise Rejected("reference_invalid") from None


def stage(archive, digest, sqlite, packet):
    try:
        packet = Path(packet)
        if shutil.disk_usage(packet.parent).free < 15 * 1024**3:
            raise Rejected("disk_headroom")
        packet.mkdir(mode=0o700)
        copy_regular(archive, packet / "snapshot.tar", snapshot.MAX_ARCHIVE)
        summary = snapshot.verify(packet / "snapshot.tar", digest)
        if summary["status"] != "candidate_only":
            raise Rejected("identity_unconfirmed")
        data = packet / "data"
        data.mkdir(mode=0o700)
        with tarfile.open(
            packet / "snapshot.tar", mode="r:", tarinfo=snapshot._BoundedInfo
        ) as tar:
            for member in tar:
                name = snapshot._name(member.name)
                if name in ("standby.signal", "recovery.signal"):
                    raise Rejected("recovery_signal")
                if name == ".":
                    continue
                target = data / name
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                # pathlib parents uses default permissions for ancestors; normalize only
                # directories in this newly created, private staging tree.
                for parent in target.parents:
                    if parent == data.parent:
                        break
                    parent.chmod(0o700)
                if member.isdir():
                    target.mkdir(mode=0o700, exist_ok=True)
                else:
                    with tar.extractfile(member) as src:
                        private_write(target, src.read(snapshot.MAX_MEMBER + 1))
        wal = Path(str(sqlite) + "-wal")
        if wal.exists() and wal.stat().st_size:
            raise Rejected("sqlite_wal_present")
        copy_regular(sqlite, packet / "references.sqlite", 16 * 1024**2)
        if wal.exists() and wal.stat().st_size:
            raise Rejected("sqlite_wal_present")
        conn = sqlite3.connect(
            (packet / "references.sqlite").resolve().as_uri() + "?mode=ro&immutable=1",
            uri=True,
        )
        try:
            conn.row_factory = sqlite3.Row
            rows = [
                dict(r)
                for r in conn.execute(
                    "SELECT sequence,owner,key,state,request,receipt,run_id FROM submissions ORDER BY sequence LIMIT 5"
                )
            ]
        finally:
            conn.close()
        for row in rows:
            row["request"] = json.loads(row["request"])
            row["receipt"] = json.loads(row["receipt"])
        refs = validate_references(rows)
        private_write(
            packet / "prepared.json", json.dumps(summary, sort_keys=True).encode()
        )
        return refs
    except Rejected:
        raise
    except (
        OSError,
        ValueError,
        TypeError,
        sqlite3.Error,
        tarfile.TarError,
        snapshot.InvalidSnapshot,
    ):
        raise Rejected("preparation_rejected") from None


def compare(refs, observed):
    checks = {
        "schema": False,
        "quiescent": False,
        "maintenance": False,
        "commands": False,
        "bindings": False,
        "archives": False,
        "review": False,
    }
    try:
        checks["schema"] = (
            observed["schema_verified"] is True and observed["major"] == 18
        )
        checks["quiescent"] = observed["quiescent"] is True
        checks["maintenance"] = len(observed["maintenance"]) == 1 and bool(
            canonical(observed["maintenance"][0])
        )
        commands = observed["commands"]
        tasks = {r["id"]: r for r in observed["tasks"]}
        runs = {r["id"]: r for r in observed["runs"]}
        if len(commands) != 4 or len(tasks) != 4 or len(runs) != 4:
            raise ValueError
        for ref in refs:
            matches = [
                c
                for c in commands
                if (c["operator_id"], c["route"], c["idempotency_key"])
                == (ref["owner"], ref["route"], ref["key"])
            ]
            if len(matches) != 1:
                raise ValueError
            c = matches[0]
            if (
                c["status"] != "completed"
                or c["payload_hash"] != ref["payload_hash"]
                or c["run_id"] != ref["run_id"]
                or c["result"] != {"status": 202, "body": ref["receipt"]}
            ):
                raise ValueError
        checks["commands"] = True
        for ref in refs:
            saved = ref["receipt"]
            task = tasks[saved["task"]["id"]]
            run = runs[ref["run_id"]]
            if any(
                task[k] != saved["task"][k]
                for k in ("id", "created_by", "project_id", "title")
            ):
                raise ValueError
            if any(
                run[k] != saved["run"][k]
                for k in (
                    "id",
                    "task_id",
                    "base_sha",
                    "profile_revision",
                    "goal",
                    "backend",
                )
            ):
                raise ValueError
            if ref["route"] == "tasks.create":
                reconstructed = {k: task[k] for k in ("project_id", "title")}
                reconstructed.update(
                    {k: run[k] for k in ("base_sha", "profile_revision", "goal")}
                )
                if reconstructed != ref["payload"]:
                    raise ValueError
        for rid in (WRITER, REVIEWER):
            if (
                runs[rid]["state"] != "succeeded"
                or runs[rid]["cleanup_state"] != "confirmed"
            ):
                raise ValueError
        checks["bindings"] = True
        archives = observed["archives"]
        raw = {}
        parsed = {}
        if len(archives) != 2:
            raise ValueError
        for archive in archives:
            rid = archive["run_id"]
            expected_sha, expected_size = EXPECTED_ARCHIVES[rid]
            payload = bytes.fromhex(archive["payload"])
            if (
                rid in raw
                or archive["pruned_at"] is not None
                or len(payload) != expected_size
                or archive["size"] != expected_size
                or archive["sha256"] != expected_sha
                or hashlib.sha256(payload).hexdigest() != expected_sha
            ):
                raise ValueError
            value = json.loads(payload)
            if (
                value["run_id"] != rid
                or value["artifact_id"] != archive["id"]
                or any(
                    value[k] != runs[rid][k]
                    for k in ("task_id", "base_sha", "profile_revision")
                )
            ):
                raise ValueError
            raw[rid] = payload
            parsed[rid] = value
        candidate = parsed[WRITER]
        review = parsed[REVIEWER]["result"]["review"]
        diff = candidate["result"]["diff"].encode()
        if (
            len(diff) != candidate["result"]["diff_bytes"]
            or hashlib.sha256(diff).hexdigest() != DIFF_SHA256
            or candidate["result"]["diff_sha256"] != DIFF_SHA256
        ):
            raise ValueError
        checks["archives"] = True
        context = runs[REVIEWER]["review_context"]
        expected_context = {
            "root_writer_run_id": WRITER,
            "writer_run_id": WRITER,
            "artifact_id": candidate["artifact_id"],
            "candidate_sha256": EXPECTED_ARCHIVES[WRITER][0],
            "review_round": 1,
            "reviewer_profile_revision": runs[REVIEWER]["profile_revision"],
        }
        if (
            context != expected_context
            or runs[REVIEWER]["purpose"] != "review"
            or bytes.fromhex(runs[REVIEWER]["review_candidate"]) != raw[WRITER]
        ):
            raise ValueError
        if (
            any(review[k] != v for k, v in expected_context.items())
            or review["reviewer_run_id"] != REVIEWER
            or review["verdict"] != "approve"
        ):
            raise ValueError
        if observed["lineages"] != [
            {
                "root_writer_run_id": WRITER,
                "first_review_run_id": REVIEWER,
                "rework_run_id": None,
                "second_review_run_id": None,
            }
        ]:
            raise ValueError
        for ref in refs:
            if ref["route"] != "tasks.create" and ref["payload"] != {
                k: context[k] for k in ("artifact_id", "candidate_sha256")
            } | {"profile_revision": context["reviewer_profile_revision"]}:
                raise ValueError
        checks["review"] = True
    except (ValueError, TypeError, KeyError, AttributeError, Rejected):
        pass
    return {
        "status": "logical_candidate_verified" if all(checks.values()) else "not_ready",
        "checks": checks,
        "original_runtime_ready": False,
        "fn07_accepted": False,
    }


def collect(conn, refs):
    # Existing AP guards are SELECT-only. No restore/finalize/migrate/locking helper.
    from agent_platform import backup
    from psycopg.rows import dict_row

    backup._major(conn)
    backup._schema(conn)
    quiescent = True
    try:
        backup._quiescent(conn)
    except ValueError as error:
        if str(error) != "backup_source_active":
            raise
        quiescent = False
    result = {"schema_verified": True, "quiescent": quiescent, "major": 18}
    with conn.cursor(row_factory=dict_row) as cur:

        def rows(sql, parameters=()):
            cur.execute(sql, parameters)
            return json.loads(json.dumps(cur.fetchall(), default=str))

        result["commands"] = []
        for ref in refs:
            result["commands"] += rows(
                "SELECT operator_id,route,idempotency_key,payload_hash,run_id,status,CASE WHEN octet_length(result::text)<=%s THEN result END AS result FROM public.commands WHERE operator_id=%s AND route=%s AND idempotency_key=%s LIMIT 2",
                (LIMIT, ref["owner"], ref["route"], ref["key"]),
            )
        ids = [r["run_id"] for r in refs]
        task_ids = [r["receipt"]["task"]["id"] for r in refs]
        result["tasks"] = rows(
            "SELECT id,created_by,project_id,title FROM public.tasks WHERE id=ANY(%s::uuid[]) LIMIT 5",
            (task_ids,),
        )
        result["runs"] = rows(
            "SELECT id,task_id,base_sha,profile_revision,CASE WHEN octet_length(goal)<=%s THEN goal END AS goal,backend,state,cleanup_state,purpose,review_context,encode(review_candidate,'hex') AS review_candidate FROM public.runs WHERE id=ANY(%s::uuid[]) LIMIT 5",
            (LIMIT, ids),
        )
        result["archives"] = rows(
            "SELECT id,run_id,sha256,size,pruned_at,CASE WHEN octet_length(payload)<=1048576 THEN encode(payload,'hex') END AS payload FROM public.result_archives WHERE run_id=ANY(%s::uuid[]) LIMIT 3",
            ([WRITER, REVIEWER],),
        )
        result["lineages"] = rows(
            "SELECT root_writer_run_id,first_review_run_id,rework_run_id,second_review_run_id FROM public.review_lineages WHERE root_writer_run_id=%s LIMIT 2",
            (WRITER,),
        )
        result["maintenance"] = [
            r["id"] for r in rows("SELECT id FROM public.maintenance_identity LIMIT 2")
        ]
    return compare(refs, result)


# A non-exec parent is essential: killing the timed child must also terminate PID1
# and thereby every PostgreSQL process even when the host orchestrator has died.
INIT = """/bin/busybox timeout -s KILL 120 /bin/sh /tools/server.sh
code=$?
exit "$code"
"""
SERVER = """set -eu
mkdir -m 700 /var/lib/postgresql/data
cp -R /source/. /var/lib/postgresql/data/
: > /var/lib/postgresql/data/postgresql.auto.conf
rm -f /var/lib/postgresql/data/postmaster.pid
exec /usr/local/bin/postgres -D /var/lib/postgresql/data -c config_file=/tools/postgresql.conf
"""
CONFIG = """listen_addresses = ''
unix_socket_directories = '/socket'
unix_socket_permissions = 0700
hba_file = '/tools/pg_hba.conf'
ident_file = '/tools/pg_ident.conf'
shared_preload_libraries = ''
session_preload_libraries = ''
local_preload_libraries = ''
archive_mode = off
archive_command = ''
restore_command = ''
primary_conninfo = ''
ssl = off
logging_collector = off
log_statement = 'none'
autovacuum = off
max_worker_processes = 0
max_wal_senders = 0
max_replication_slots = 0
shared_buffers = '32MB'
max_connections = 5
max_wal_size = '128MB'
min_wal_size = '32MB'
temp_file_limit = '32MB'
statement_timeout = '10s'
lock_timeout = '2s'
default_transaction_read_only = on
"""


def setup_tools(packet):
    uid, gid = os.getuid(), os.getgid()
    if uid == 0:
        raise Rejected("nonroot_required")
    if len(os.fsencode(packet / "socket")) > 85:
        raise Rejected("socket_path_limit")
    (packet / "tools").mkdir(mode=0o700)
    (packet / "socket").mkdir(mode=0o700)
    for name, value in {
        "init.sh": INIT,
        "server.sh": SERVER,
        "postgresql.conf": CONFIG,
        "pg_hba.conf": "local all all trust\n",
        "pg_ident.conf": "",
        "passwd": f"postgres:x:{uid}:{gid}:diagnostic:/tmp:/bin/sh\n",
    }.items():
        private_write(packet / "tools" / name, value.encode())


def container_command(packet, name, uid, gid):
    if (
        uid <= 0
        or gid < 0
        or not re.fullmatch("[a-z0-9-]+", name)
        or "," in str(packet)
    ):
        raise Rejected("launch_invalid")
    packet = packet.resolve()
    args = [
        "create",
        "--name",
        name,
        "--label",
        f"fanz.copy={name}",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        f"{uid}:{gid}",
        "--pids-limit",
        "64",
        "--memory",
        "512m",
        "--memory-swap",
        "512m",
        "--cpus",
        "0.5",
        "--restart",
        "no",
        "--stop-timeout",
        "3",
        "--log-driver",
        "json-file",
        "--log-opt",
        "max-size=1m",
        "--log-opt",
        "max-file=1",
        "--tmpfs",
        f"/var/lib/postgresql:rw,noexec,nosuid,nodev,size=256m,uid={uid},gid={gid},mode=0700",
        "--tmpfs",
        f"/tmp:rw,noexec,nosuid,nodev,size=8m,uid={uid},gid={gid},mode=0700",
    ]
    for source, target, readonly in [
        ("data", "/source", True),
        ("tools", "/tools", True),
        ("tools/passwd", "/etc/passwd", True),
        ("socket", "/socket", False),
    ]:
        args += [
            "--mount",
            f"type=bind,source={packet / source},target={target}"
            + (",readonly" if readonly else ""),
        ]
    return args + ["--entrypoint", "/bin/sh", IMAGE, "/tools/init.sh"]


def docker(*args):
    try:
        result = subprocess.run(
            ["docker", "--host", "unix:///var/run/docker.sock", *args],
            env={"PATH": os.environ["PATH"], "LANG": "C"},
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=15,
            check=True,
        )
        if len(result.stdout) > LIMIT or len(result.stderr) > LIMIT:
            raise Rejected("docker_output_limit")
        return (
            result.stdout + result.stderr
            if args and args[0] == "logs"
            else result.stdout
        )
    except (OSError, subprocess.SubprocessError):
        raise Rejected("docker_unknown") from None


def inspect_owned(name):
    value = json.loads(docker("inspect", name))
    if len(value) != 1 or value[0]["Config"]["Labels"].get("fanz.copy") != name:
        raise Rejected("container_identity")
    return value[0]


def check_boundary(value, packet):
    h = value["HostConfig"]
    c = value["Config"]
    expected = {
        str((packet / source).resolve()): (target, not ro)
        for source, target, ro in [
            ("data", "/source", True),
            ("tools", "/tools", True),
            ("tools/passwd", "/etc/passwd", True),
            ("socket", "/socket", False),
        ]
    }
    uid, gid = os.getuid(), os.getgid()
    tmpfs = {
        p: f"rw,noexec,nosuid,nodev,size={size},uid={uid},gid={gid},mode=0700"
        for p, size in [("/var/lib/postgresql", "256m"), ("/tmp", "8m")]
    }
    actual = {
        m["Source"]: (m["Destination"], m["RW"])
        for m in value["Mounts"]
        if m["Type"] == "bind"
    }
    if (
        actual != expected
        or any(m["Type"] == "volume" for m in value["Mounts"])
        or h["NetworkMode"] != "none"
        or not h["ReadonlyRootfs"]
        or h["Privileged"]
        or h["PortBindings"]
        or h["CapDrop"] != ["ALL"]
        or h["CapAdd"]
        or "no-new-privileges" not in h["SecurityOpt"]
        or h["PidsLimit"] != 64
        or h["Memory"] != 512 * 1024**2
        or h["MemorySwap"] != 512 * 1024**2
        or h["NanoCpus"] != 500000000
        or h["RestartPolicy"]["Name"] != "no"
        or c["User"] != f"{os.getuid()}:{os.getgid()}"
        or c["Image"] != IMAGE
        or c["Entrypoint"] != ["/bin/sh"]
        or c["Cmd"] != ["/tools/init.sh"]
        or h["Tmpfs"] != tmpfs
        or h.get("Binds")
        or h.get("Devices")
        or h.get("DeviceRequests")
        or h.get("PidMode")
        or h.get("VolumesFrom")
        or h.get("CapAdd")
    ):
        raise Rejected("container_boundary")


def cleanup(name):
    try:
        value = inspect_owned(name)
        cid = value["Id"]
        if value["State"]["Running"]:
            docker("stop", "--time", "3", cid)
        value = inspect_owned(name)
        if (
            value["Id"] != cid
            or value["State"]["Running"]
            or value["State"].get("Restarting")
        ):
            return False
        docker("rm", cid)
        return True
    except (Rejected, ValueError, TypeError, KeyError):
        return False


def probe_socket(socket, dbname, user, refs):
    import psycopg

    deadline = time.monotonic() + 35
    while True:
        try:
            conn = psycopg.connect(
                host=str(socket),
                dbname=dbname,
                user=user,
                connect_timeout=2,
                options="-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000 -c session_preload_libraries= -c local_preload_libraries= -c search_path=pg_catalog,public",
            )
            break
        except psycopg.OperationalError:
            if time.monotonic() >= deadline:
                raise Rejected("copy_startup_failed") from None
            time.sleep(0.2)
    with conn:
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        result = collect(conn, refs)
        conn.rollback()
        return result


def execute(packet, refs, dbname, user):
    for value in (dbname, user):
        if not re.fullmatch("[A-Za-z_][A-Za-z_0-9]{0,62}", value):
            raise Rejected("database_identity_invalid")
    setup_tools(packet)
    name = "fz-copy-" + uuid4().hex
    binding = json.loads((packet / "prepared.json").read_text())
    private_write(
        packet / "intent.json",
        json.dumps(
            {
                "state": "intent",
                "authorization": "explicit_execute_invocation",
                "container_name": name,
                "image": IMAGE,
                "archive_sha256": binding["sha256"],
                "references_sha256": hashlib.sha256(
                    (packet / "references.sqlite").read_bytes()
                ).hexdigest(),
            }
        ).encode(),
    )
    result = {
        "status": "not_ready",
        "reason": "copy_check_failed",
        "original_runtime_ready": False,
        "fn07_accepted": False,
    }
    try:
        image = json.loads(docker("image", "inspect", IMAGE))[0]
        if (
            image["Os"] != "linux"
            or image["Architecture"] != "amd64"
            or "PG_MAJOR=18" not in image["Config"]["Env"]
            or "PG_VERSION=18.6" not in image["Config"]["Env"]
            or set(image["Config"]["Volumes"]) != {"/var/lib/postgresql"}
        ):
            raise Rejected("image_compatibility")
        cid = (
            docker(*container_command(packet, name, os.getuid(), os.getgid()))
            .decode()
            .strip()
        )
        if not re.fullmatch("[0-9a-f]{64}", cid):
            raise Rejected("container_identity")
        private_write(
            packet / "created.json",
            json.dumps({"state": "created", "id": cid}).encode(),
        )
        value = inspect_owned(name)
        if value["Id"] != cid:
            raise Rejected("container_identity")
        check_boundary(value, packet)
        private_write(packet / "inspection.json", json.dumps(value).encode())
        docker("start", cid)
        private_write(packet / "started.json", b'{"state":"started"}')
        result = probe_socket(packet / "socket", dbname, user, refs)
    except Exception as error:  # noqa: BLE001 -- private boundary for optional DB dependencies
        # Private diagnostics only; public response never includes exception text.
        try:
            private_write(packet / "failure-private.txt", str(error).encode()[:8192])
        except OSError:
            result["failure_diagnostic_available"] = False
    finally:
        try:
            private_write(packet / "server-private.log", docker("logs", name))
            logs_available = True
        except (Rejected, OSError):
            logs_available = False
        stopped = cleanup(name)
        if not stopped:
            result = {
                "status": "outcome_unknown",
                "reason": "cleanup_unconfirmed",
                "original_runtime_ready": False,
                "fn07_accepted": False,
            }
        result["cleanup_confirmed"] = stopped
        result["diagnostic_logs_available"] = logs_available
        result["receipt_persisted"] = True
        try:
            private_write(
                packet / "outcome.json", json.dumps(result, sort_keys=True).encode()
            )
        except OSError:
            result["receipt_persisted"] = False
            if result["status"] != "outcome_unknown":
                result["status"] = "not_ready"
                result["reason"] = "outcome_receipt_unavailable"
            # Never lose cleanup_unconfirmed because its receipt also failed.
    return result


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Rejected("arguments")


def main():
    try:
        parser = Parser(description=__doc__)
        parser.add_argument("--archive", required=True)
        parser.add_argument("--sha256", required=True)
        parser.add_argument("--sqlite", required=True)
        parser.add_argument("--packet", required=True)
        parser.add_argument("--execute", action="store_true")
        parser.add_argument("--database")
        parser.add_argument("--user")
        args = parser.parse_args()
        packet = Path(args.packet).absolute()
        refs = stage(args.archive, args.sha256, args.sqlite, packet)
        result = {
            "status": "prepared_only",
            "original_runtime_ready": False,
            "fn07_accepted": False,
        }
        if args.execute:
            sys.path.insert(
                0, str(Path(__file__).resolve().parents[3] / "agent-platform/src")
            )
            result = execute(packet, refs, args.database, args.user)
    except Exception:  # noqa: BLE001 -- CLI must not disclose paths, SQL or connection values
        result = {
            "status": "not_ready",
            "reason": "diagnostic_rejected",
            "original_runtime_ready": False,
            "fn07_accepted": False,
        }
    print(json.dumps(result, sort_keys=True))
    return (
        0 if result["status"] in ("prepared_only", "logical_candidate_verified") else 2
    )


if __name__ == "__main__":
    raise SystemExit(main())
