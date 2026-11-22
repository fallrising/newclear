import copy
import hashlib
import io
import json
import os
import sqlite3
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import copy_validation as cv


def uid(number):
    return str(UUID(int=number))


def references():
    rows = []
    for n, run_id in enumerate([uid(1), uid(2), cv.WRITER, cv.REVIEWER]):
        task = {
            "id": uid(20 + n),
            "created_by": uid(30),
            "project_id": uid(40),
            "title": "fixture",
        }
        run = {
            "id": run_id,
            "task_id": task["id"],
            "base_sha": "a" * 40,
            "profile_revision": uid(50 + n),
            "goal": "fixture",
            "backend": "fake",
        }
        request = {k: task[k] for k in ("project_id", "title")}
        request.update({k: run[k] for k in ("base_sha", "profile_revision", "goal")})
        rows.append(
            {
                "sequence": n + 1,
                "owner": uid(30),
                "key": uid(60 + n),
                "state": "confirmed",
                "request": request,
                "receipt": {"task": task, "run": run},
                "run_id": run_id,
            }
        )
    rows[-1]["request"] = {
        "route": f"/api/v1/runs/{cv.WRITER}/reviews",
        "body": {
            "artifact_id": uid(90),
            "candidate_sha256": "a" * 64,
            "profile_revision": rows[-1]["receipt"]["run"]["profile_revision"],
        },
    }
    return rows


def database(path, rows=None):
    with sqlite3.connect(path) as c:
        c.execute(
            "create table submissions(sequence integer, owner text, key text, state text, request text, receipt text, run_id text)"
        )
        for r in rows if rows is not None else references():
            c.execute(
                "insert into submissions values(?,?,?,?,?,?,?)",
                tuple(
                    json.dumps(r[k]) if k in ("request", "receipt") else r[k]
                    for k in (
                        "sequence",
                        "owner",
                        "key",
                        "state",
                        "request",
                        "receipt",
                        "run_id",
                    )
                ),
            )


class StageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.archive = self.root / "source.tar"
        self.db = self.root / "original.sqlite"
        database(self.db)

    def bundle(self, extra=()):
        with tarfile.open(self.archive, "w") as t:
            for name, data in [
                ("PG_VERSION", b"18\n"),
                ("base/1/123", (cv.WRITER + cv.REVIEWER).encode()),
                *extra,
            ]:
                m = tarfile.TarInfo(name)
                m.size = len(data)
                t.addfile(m, io.BytesIO(data))
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def test_stage_private_exact_copy_source_unchanged_and_no_reuse(self):
        digest = self.bundle()
        before = self.db.read_bytes()
        packet = self.root / "packet"
        result = cv.stage(self.archive, digest, self.db, packet)
        self.assertEqual(len(result), 4)
        self.assertEqual((packet / "data/PG_VERSION").read_bytes(), b"18\n")
        self.assertEqual((packet / "data").stat().st_mode & 0o777, 0o700)
        self.assertEqual((packet / "data/PG_VERSION").stat().st_mode & 0o777, 0o600)
        self.assertEqual(hashlib.sha256(self.archive.read_bytes()).hexdigest(), digest)
        self.assertEqual(self.db.read_bytes(), before)
        with self.assertRaises(cv.Rejected):
            cv.stage(self.archive, digest, self.db, packet)

    def test_bad_digest_path_signal_symlink_and_wal_rejected(self):
        for extra in [
            [("../outside", b"x")],
            [("standby.signal", b"")],
            [("recovery.signal", b"")],
        ]:
            with self.subTest(extra=extra):
                digest = self.bundle(extra)
                with (
                    tempfile.TemporaryDirectory() as root,
                    self.assertRaises(cv.Rejected),
                ):
                    cv.stage(self.archive, digest, self.db, Path(root) / "packet")
        digest = self.bundle()
        with self.assertRaises(cv.Rejected):
            cv.stage(self.archive, "0" * 64, self.db, self.root / "bad")
        link = self.root / "link"
        link.symlink_to(self.archive)
        with self.assertRaises(cv.Rejected):
            cv.stage(link, digest, self.db, self.root / "link-packet")
        Path(str(self.db) + "-wal").write_bytes(b"pending")
        with self.assertRaises(cv.Rejected):
            cv.stage(self.archive, digest, self.db, self.root / "wal-packet")

    def test_references_fail_closed_and_no_private_exception(self):
        rows = references()
        self.assertEqual(len(cv.validate_references(rows)), 4)
        for mutated in [
            rows[:3],
            [dict(r, state="unknown") for r in rows],
            [dict(r, key="secret-not-uuid") for r in rows],
        ]:
            with self.assertRaises(cv.Rejected) as error:
                cv.validate_references(mutated)
            self.assertNotIn("secret", str(error.exception))


class CompareTests(unittest.TestCase):
    def fixture(self):
        refs = cv.validate_references(references())
        commands = []
        tasks = []
        runs = []
        for r in refs:
            commands.append(
                {
                    "operator_id": r["owner"],
                    "route": r["route"],
                    "idempotency_key": r["key"],
                    "payload_hash": r["payload_hash"],
                    "run_id": r["run_id"],
                    "status": "completed",
                    "result": {"status": 202, "body": r["receipt"]},
                }
            )
            tasks.append(copy.deepcopy(r["receipt"]["task"]))
            runs.append(
                dict(r["receipt"]["run"], state="succeeded", cleanup_state="confirmed")
            )
        diff = "synthetic diff\n"
        candidate = json.dumps(
            {
                **{k: runs[-2][k] for k in ("task_id", "base_sha", "profile_revision")},
                "run_id": cv.WRITER,
                "artifact_id": uid(90),
                "result": {
                    "diff": diff,
                    "diff_bytes": len(diff.encode()),
                    "diff_sha256": hashlib.sha256(diff.encode()).hexdigest(),
                },
            }
        ).encode()
        sha = hashlib.sha256(candidate).hexdigest()
        refs[-1]["payload"]["candidate_sha256"] = sha
        refs[-1]["payload_hash"] = hashlib.sha256(
            json.dumps(
                refs[-1]["payload"], sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        commands[-1]["payload_hash"] = refs[-1]["payload_hash"]
        context = {
            "writer_run_id": cv.WRITER,
            "root_writer_run_id": cv.WRITER,
            "artifact_id": uid(90),
            "candidate_sha256": sha,
            "review_round": 1,
            "reviewer_profile_revision": runs[-1]["profile_revision"],
        }
        review = json.dumps(
            {
                **{k: runs[-1][k] for k in ("task_id", "base_sha", "profile_revision")},
                "run_id": cv.REVIEWER,
                "artifact_id": uid(91),
                "result": {
                    "review": dict(
                        context,
                        reviewer_run_id=cv.REVIEWER,
                        verdict="approve",
                        reasons=["fixture"],
                    )
                },
            }
        ).encode()
        runs[-1].update(
            purpose="review", review_context=context, review_candidate=candidate.hex()
        )
        archives = [
            {
                "id": uid(90 + i),
                "run_id": run,
                "payload": raw.hex(),
                "sha256": hashlib.sha256(raw).hexdigest(),
                "size": len(raw),
                "pruned_at": None,
            }
            for i, (run, raw) in enumerate(
                [(cv.WRITER, candidate), (cv.REVIEWER, review)]
            )
        ]
        observed = {
            "commands": commands,
            "tasks": tasks,
            "runs": runs,
            "archives": archives,
            "lineages": [
                {
                    "root_writer_run_id": cv.WRITER,
                    "first_review_run_id": cv.REVIEWER,
                    "rework_run_id": None,
                    "second_review_run_id": None,
                }
            ],
            "maintenance": [uid(99)],
            "schema_verified": True,
            "quiescent": True,
            "major": 18,
        }
        expected = {a["run_id"]: (a["sha256"], a["size"]) for a in archives}
        return refs, observed, expected

    def test_positive_and_each_identity_hash_state_lineage_mismatch(self):
        refs, observed, expected = self.fixture()
        with (
            patch.object(cv, "EXPECTED_ARCHIVES", expected),
            patch.object(
                cv, "DIFF_SHA256", hashlib.sha256(b"synthetic diff\n").hexdigest()
            ),
        ):
            self.assertEqual(
                cv.compare(refs, observed)["status"], "logical_candidate_verified"
            )
            cases = [
                ("commands", 0, "payload_hash", "0" * 64),
                ("commands", 0, "route", "other"),
                ("tasks", 0, "created_by", uid(999)),
                ("runs", 0, "task_id", uid(999)),
                ("runs", 3, "state", "running"),
                ("archives", 0, "payload", "00"),
                ("archives", 1, "sha256", "0" * 64),
                ("lineages", 0, "first_review_run_id", uid(999)),
            ]
            for group, index, key, value in cases:
                mutated = copy.deepcopy(observed)
                mutated[group][index][key] = value
                with self.subTest(group=group, key=key):
                    self.assertEqual(cv.compare(refs, mutated)["status"], "not_ready")
            for key, value in [
                ("maintenance", []),
                ("schema_verified", False),
                ("quiescent", False),
                ("major", 16),
            ]:
                mutated = copy.deepcopy(observed)
                mutated[key] = value
                self.assertEqual(cv.compare(refs, mutated)["status"], "not_ready")


class RuntimeTests(unittest.TestCase):
    def test_launch_boundary_and_parent_independent_deadline(self):
        command = cv.container_command(Path("/tmp/private"), "fixture", 1000, 1000)
        text = " ".join(command)
        for expected in [
            "--network none",
            "--read-only",
            "--cap-drop ALL",
            "--security-opt no-new-privileges",
            "--pull never",
            "size=256m",
            "readonly",
            "--user 1000:1000",
        ]:
            self.assertIn(expected, text)
        self.assertNotIn("--publish", text)
        self.assertNotIn("--privileged", text)
        self.assertIn("timeout -s KILL 120", cv.INIT)
        self.assertIn("code=$?", cv.INIT)

    def test_cleanup_unknown_cannot_be_success(self):
        with patch.object(cv, "docker", side_effect=cv.Rejected("docker_unknown")):
            self.assertFalse(cv.cleanup("fixture"))


class BoundaryRegressionTests(unittest.TestCase):
    def test_sqlite_reference_route_receipt_and_duplicate_rejected(self):
        original = references()
        cases = []
        rows = copy.deepcopy(original)
        rows[-1]["request"]["route"] = "/api/v1/private"
        cases.append(rows)
        rows = copy.deepcopy(original)
        rows[0]["receipt"]["run"]["task_id"] = uid(999)
        cases.append(rows)
        rows = copy.deepcopy(original)
        rows[1]["key"] = rows[0]["key"]
        cases.append(rows)
        rows = copy.deepcopy(original)
        rows[-1]["request"]["body"]["candidate_sha256"] = "secret"
        cases.append(rows)
        for rows in cases:
            with self.assertRaises(cv.Rejected):
                cv.validate_references(rows)

    def test_missing_duplicate_receipt_request_and_review_bytes_not_verified(self):
        refs, original, expected = CompareTests().fixture()
        mutations = []
        v = copy.deepcopy(original)
        v["commands"][0]["result"]["body"]["task"]["title"] = "different"
        mutations.append(v)
        v = copy.deepcopy(original)
        v["commands"].pop()
        mutations.append(v)
        v = copy.deepcopy(original)
        v["archives"].append(v["archives"][0])
        mutations.append(v)
        v = copy.deepcopy(original)
        v["runs"][-1]["review_candidate"] = "00"
        mutations.append(v)
        v = copy.deepcopy(original)
        v["runs"][-1]["review_context"]["writer_run_id"] = uid(999)
        mutations.append(v)
        v = copy.deepcopy(original)
        v["archives"][0]["pruned_at"] = "2026-01-01"
        mutations.append(v)
        with (
            patch.object(cv, "EXPECTED_ARCHIVES", expected),
            patch.object(
                cv, "DIFF_SHA256", hashlib.sha256(b"synthetic diff\n").hexdigest()
            ),
        ):
            for observed in mutations:
                self.assertEqual(cv.compare(refs, observed)["status"], "not_ready")
            wrong = copy.deepcopy(refs)
            wrong[0]["payload"]["goal"] = "different"
            self.assertEqual(cv.compare(wrong, original)["status"], "not_ready")

    def test_cleanup_only_stopped_owned_exact_id_and_failures(self):
        def owned(running=False):
            return {
                "Id": "a" * 64,
                "Config": {"Labels": {"fanz.copy": "fixture"}},
                "State": {"Running": running, "Restarting": False},
            }

        with (
            patch.object(cv, "inspect_owned", side_effect=[owned(True), owned(False)]),
            patch.object(cv, "docker", return_value=b"") as call,
        ):
            self.assertTrue(cv.cleanup("fixture"))
            self.assertEqual(
                call.call_args_list[0].args, ("stop", "--time", "3", "a" * 64)
            )
            self.assertEqual(call.call_args_list[1].args, ("rm", "a" * 64))
        with (
            patch.object(cv, "inspect_owned", side_effect=[owned(True), owned(True)]),
            patch.object(cv, "docker", return_value=b"") as call,
        ):
            self.assertFalse(cv.cleanup("fixture"))
            self.assertEqual(call.call_count, 1)
        with patch.object(
            cv,
            "docker",
            return_value=json.dumps(
                [{"Config": {"Labels": {"fanz.copy": "foreign"}}}]
            ).encode(),
        ) as call:
            self.assertFalse(cv.cleanup("fixture"))
            self.assertEqual(call.call_count, 1)

    def test_cli_errors_do_not_expose_input(self):
        import subprocess
        import sys

        result = subprocess.run(
            [
                sys.executable,
                str(Path(cv.__file__)),
                "--archive",
                "/private-secret/file",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("private-secret", result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")

    def test_launch_profile_rejects_any_writable_source_or_weaker_limits(self):
        packet = Path("/tmp/private")
        u = os.getuid()
        g = os.getgid()
        value = {
            "Config": {
                "User": f"{u}:{g}",
                "Image": cv.IMAGE,
                "Entrypoint": ["/bin/sh"],
                "Cmd": ["/tools/init.sh"],
            },
            "HostConfig": {
                "NetworkMode": "none",
                "ReadonlyRootfs": True,
                "Privileged": False,
                "PortBindings": {},
                "CapDrop": ["ALL"],
                "CapAdd": None,
                "SecurityOpt": ["no-new-privileges"],
                "PidsLimit": 64,
                "Memory": 512 * 1024**2,
                "MemorySwap": 512 * 1024**2,
                "NanoCpus": 500000000,
                "RestartPolicy": {"Name": "no"},
                "Tmpfs": {
                    p: f"rw,noexec,nosuid,nodev,size={size},uid={u},gid={g},mode=0700"
                    for p, size in [("/var/lib/postgresql", "256m"), ("/tmp", "8m")]
                },
            },
            "Mounts": [
                {"Source": str(packet / s), "Destination": d, "RW": rw, "Type": "bind"}
                for s, d, rw in [
                    ("data", "/source", False),
                    ("tools", "/tools", False),
                    ("tools/passwd", "/etc/passwd", False),
                    ("socket", "/socket", True),
                ]
            ],
        }
        cv.check_boundary(value, packet)
        for key, new in [
            ("NetworkMode", "host"),
            ("ReadonlyRootfs", False),
            ("Memory", 0),
            ("Tmpfs", {}),
            ("PidMode", "host"),
        ]:
            v = copy.deepcopy(value)
            v["HostConfig"][key] = new
            with self.assertRaises(cv.Rejected):
                cv.check_boundary(v, packet)
        v = copy.deepcopy(value)
        v["Mounts"][0]["RW"] = True
        with self.assertRaises(cv.Rejected):
            cv.check_boundary(v, packet)


class OutcomePersistenceTests(unittest.TestCase):
    def test_unknown_cleanup_survives_full_disk_and_verified_needs_receipt(self):
        image = {
            "Os": "linux",
            "Architecture": "amd64",
            "Config": {
                "Env": ["PG_MAJOR=18", "PG_VERSION=18.6"],
                "Volumes": {"/var/lib/postgresql": {}},
            },
        }

        def docker(*args):
            return json.dumps([image]).encode() if args[0] == "image" else b"a" * 64

        for stopped, probe_failed in [(False, False), (False, True), (True, False)]:
            with (
                self.subTest(stopped=stopped, probe_failed=probe_failed),
                tempfile.TemporaryDirectory() as root,
            ):
                packet = Path(root)
                (packet / "prepared.json").write_text(json.dumps({"sha256": "a" * 64}))
                (packet / "references.sqlite").write_bytes(b"synthetic")

                def write(path, data):
                    if path.name in ("outcome.json", "failure-private.txt"):
                        raise OSError("private-secret-disk-error")

                with (
                    patch.object(cv, "setup_tools"),
                    patch.object(cv, "private_write", side_effect=write),
                    patch.object(cv, "docker", side_effect=docker),
                    patch.object(cv, "inspect_owned", return_value={"Id": "a" * 64}),
                    patch.object(cv, "check_boundary"),
                    patch.object(cv, "cleanup", return_value=stopped),
                    patch.object(
                        cv,
                        "probe_socket",
                        side_effect=cv.Rejected("copy_check_failed")
                        if probe_failed
                        else None,
                        return_value={"status": "logical_candidate_verified"},
                    ),
                ):
                    result = cv.execute(packet, [], "postgres", "postgres")
                self.assertEqual(
                    result["status"], "not_ready" if stopped else "outcome_unknown"
                )
                self.assertFalse(result["receipt_persisted"])
                self.assertNotIn("private-secret", json.dumps(result))
                if not stopped:
                    self.assertEqual(result["reason"], "cleanup_unconfirmed")
