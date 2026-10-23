#!/usr/bin/env python3
"""Check the actual app-data startup barrier, restart and migration failure."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time


def main():
    artifacts = Path(os.environ["AGENT_ARTIFACTS_DIR"])
    artifacts.mkdir(parents=True, exist_ok=True)
    data = Path(tempfile.mkdtemp(prefix="db-startup-", dir=artifacts))
    evidence = Path(os.environ["AGENT_EVIDENCE_DIR"]) / "linux-db"
    evidence.mkdir(parents=True, exist_ok=True)
    evidence = Path(tempfile.mkdtemp(prefix="run-", dir=evidence))
    env = {**os.environ, "XDG_DATA_HOME": str(data), "AGENT_EVIDENCE_DIR": str(evidence)}
    result = {"passed": False, "macosAcceptance": False}
    (evidence / "result.json").write_text(json.dumps(result) + "\n")
    smoke = Path(__file__).with_name("linux-native-smoke.py")
    subprocess.run([sys.executable, str(smoke)], env=env, check=True, timeout=45)
    database = data / "com.fallrising.flowshot" / "flowshot.sqlite3"
    if not database.is_file():
        raise RuntimeError("native app did not initialize its platform app-data database")
    with sqlite3.connect(database) as db:
        migrations = db.execute("SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version").fetchall()
        if not migrations or db.execute("PRAGMA journal_mode").fetchone()[0] != "wal":
            raise RuntimeError("missing migrations or WAL mode")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("foreign key violation after startup")
        # A fixture row tests persistence across actual process restarts.
        db.execute("INSERT INTO app_state VALUES ('smoke','restart','{\"preserved\":true}',1)")
    subprocess.run([sys.executable, str(smoke)], env=env, check=True, timeout=45)
    with sqlite3.connect(database) as db:
        if db.execute("SELECT value_json FROM app_state WHERE scope='smoke' AND key='restart'").fetchone() != ('{"preserved":true}',):
            raise RuntimeError("fixture lost after native process restart")
        if db.execute("SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version").fetchall() != migrations:
            raise RuntimeError("restart modified migration records")
        db.execute("UPDATE schema_migrations SET checksum='tampered' WHERE version=?", (migrations[0][0],))

    target = Path(os.environ["CARGO_TARGET_DIR"])
    if os.environ.get("CARGO_BUILD_TARGET"):
        target /= os.environ["CARGO_BUILD_TARGET"]
    with (evidence / "failure-stdout.log").open("w+") as stdout, (evidence / "failure-stderr.log").open("w") as stderr:
        app = subprocess.Popen([str(target / "debug/flowshot-tauri")], env=env, stdout=stdout, stderr=stderr)
        try:
            deadline = time.monotonic() + 15
            while app.poll() is None and time.monotonic() < deadline:
                probe = subprocess.run(["xdotool", "search", "--onlyvisible", "--pid", str(app.pid)], capture_output=True, timeout=2, check=False)
                if probe.returncode == 0 and probe.stdout.strip():
                    raise RuntimeError("migration failure exposed a visible application window")
                time.sleep(0.02)
            code = app.wait(timeout=1)
            stdout.seek(0)
            output = stdout.read()
            failure = (evidence / "failure-stderr.log").read_text()
            if (code == 0 or '"command":"get_build_info"' in output
                    or '"event":"database_ready"' in output
                    or "database initialization failed" not in failure):
                raise RuntimeError("migration failure did not stop startup before frontend IPC")
        finally:
            if app.poll() is None:
                app.terminate()
                try:
                    app.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    app.kill()
                    app.wait(timeout=5)
    with sqlite3.connect(database) as db:
        expected = [(version, "tampered" if index == 0 else checksum, applied_at)
                    for index, (version, checksum, applied_at) in enumerate(migrations)]
        if db.execute("SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version").fetchall() != expected:
            raise RuntimeError("rejected startup modified migration metadata")
        if db.execute("SELECT value_json FROM app_state WHERE scope='smoke' AND key='restart'").fetchone() != ('{"preserved":true}',):
            raise RuntimeError("rejected startup modified persisted fixture")
    result.update(passed=True, restartPreserved=True, tamperedMigrationRejectedBeforeWindow=True)
    (evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print("Native app-data initialization, restart and fail-before-window checks passed")


if __name__ == "__main__":
    main()
