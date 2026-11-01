#!/usr/bin/env python3
"""Exercise the actual debug Tauri binary's SQLite boot/recovery under Linux.

Requires Python 3, xvfb-run, a built debug binary, and a frontend dist directory.
Uses disposable vaults, a local-only static server and no provider credentials.
This verifies native startup/recovery, not interactive GUI or process reattach.
"""

import argparse
import contextlib
import functools
import http.server
import os
from pathlib import Path
import shlex
import signal
import sqlite3
import subprocess
import tempfile
import threading
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=25)
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    dist = args.dist.resolve(strict=True)
    if not (dist / "index.html").is_file():
        parser.error("--dist must contain the built frontend index.html")
    requests = []

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            # Each boot must fetch the tested bundle rather than reuse WebKit's
            # persistent cache from an earlier process on the same dev URL.
            if "If-Modified-Since" in self.headers:
                del self.headers["If-Modified-Since"]
            super().do_GET()

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, format_string, *values):
            if len(values) >= 2:
                requests.append((self.path, str(values[1])))

    handler = functools.partial(Handler, directory=str(dist))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 1420), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    with tempfile.TemporaryDirectory(prefix="loom-native-recovery-") as temporary:
        root = Path(temporary)
        vault = root / "vault"
        vault.mkdir()
        (vault / ".loom").mkdir()
        document = vault / "notes.md"
        document.write_text("User document must stay unchanged.\n")
        sidecar = vault / ".loom" / "canvas.json"
        # Deliberately unsupported data must remain untouched by UI hydration.
        sidecar.write_text('{"version":999,"nodes":[],"edges":[]}\n')
        original_doc, original_canvas = document.read_bytes(), sidecar.read_bytes()
        database = vault / ".loom" / "sessions.db"
        marker = root / "unexpected-command-executed"

        @contextlib.contextmanager
        def boot(directory, name):
            log_path = root / f"{name}.log"
            env = {**os.environ, "LOOM_VAULT": str(directory)}
            # WebKit's disk cache survives separate app processes. Isolate the
            # browser profile so every boot actually requests this run's dist.
            for variable, suffix in (("XDG_CACHE_HOME", "cache"), ("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config")):
                profile_path = root / f"{name}-{suffix}"
                profile_path.mkdir()
                env[variable] = str(profile_path)
            # Container-only test setting. Does not change application config.
            if os.geteuid() == 0:
                env["WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS"] = "1"
            with log_path.open("w") as log:
                process = subprocess.Popen(
                    ["xvfb-run", "-a", str(binary)], env=env,
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                )
                try:
                    yield process
                except BaseException:
                    print(f"Native log ({name}):\n{log_path.read_text()[-6000:]}")
                    print(f"Recent frontend requests: {requests[-10:]!r}")
                    with contextlib.suppress(sqlite3.Error):
                        print(f"Stored recovery rows: {rows()!r}")
                    raise
                finally:
                    # The wrapper may exit before its children. Clean the whole
                    # group even when wait() already has a wrapper exit status.
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=4)
                    except subprocess.TimeoutExpired:
                        pass
                    finally:
                        with contextlib.suppress(ProcessLookupError):
                            os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=4)
                    guard = directory / ".loom" / "sessions.guard.db"
                    if guard.is_file():
                        # Child exit, rather than wrapper exit, must release
                        # vault ownership before another boot or seeded write.
                        with contextlib.closing(sqlite3.connect(guard, timeout=4)) as conn:
                            conn.execute("BEGIN IMMEDIATE")
                            conn.rollback()

        def await_condition(process, predicate, label):
            until = time.monotonic() + args.timeout
            while time.monotonic() < until:
                if process.poll() is not None:
                    raise AssertionError(f"Native app exited while waiting for {label}")
                try:
                    if predicate():
                        return
                except sqlite3.OperationalError:
                    pass  # DB/schema creation may still be completing.
                time.sleep(0.1)
            raise AssertionError(f"Timed out waiting for {label}")

        def rows():
            if not database.is_file():
                return None
            # Read-only so the test cannot create the DB in place of the app.
            with contextlib.closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as conn:
                return conn.execute("SELECT id, state, cwd, cmd, shell FROM sessions ORDER BY id").fetchall()

        def frontend_loaded(start):
            return any(path.endswith(".js") and status == "200" for path, status in requests[start:])

        try:
            start = len(requests)
            with boot(vault, "initial") as process:
                await_condition(process, lambda: rows() == [] and frontend_loaded(start), "native-created store and frontend")
                time.sleep(1)
                assert process.poll() is None, "Native app exited after creating its store"
            print("PASS: native Tauri startup creates a queryable per-vault store and loads frontend")

            command = f"printf unexpected > {shlex.quote(str(marker))}"
            with contextlib.closing(sqlite3.connect(database)) as conn:
                conn.execute(
                    "INSERT INTO sessions (id,cwd,cmd,shell,state,last_activity_ms) VALUES (?,?,?,?,?,?)",
                    ("native-recovery-seed", str(vault), command, "/bin/sh", "active", 1),
                )
                conn.commit()
            expected = [("native-recovery-seed", "tombstone", str(vault), command, "/bin/sh")]
            for attempt in (1, 2):
                start = len(requests)
                with boot(vault, f"recovery-{attempt}") as process:
                    await_condition(process, lambda: rows() == expected and frontend_loaded(start), "native tombstone recovery")
                    time.sleep(1)
                    assert process.poll() is None, "Native app exited after recovery"
                    assert not marker.exists(), "Startup reran a saved command"
                    assert document.read_bytes() == original_doc, "Recovery changed Markdown"
                    assert sidecar.read_bytes() == original_canvas, "Recovery changed an unsupported sidecar"
                assert not marker.exists(), "Saved command ran before native teardown completed"
            print("PASS: native relaunch tombstones prior active metadata, remains idempotent, and never reruns command")
            print("PASS: Markdown and unsupported canvas sidecar stay byte-identical across native restarts")

            corrupt_vault = root / "corrupt-vault"
            (corrupt_vault / ".loom").mkdir(parents=True)
            corrupt_db = corrupt_vault / ".loom" / "sessions.db"
            corrupt_bytes = b"deliberately invalid sqlite database\x00preserve me"
            corrupt_db.write_bytes(corrupt_bytes)
            start = len(requests)
            with boot(corrupt_vault, "corrupt") as process:
                await_condition(process, lambda: frontend_loaded(start), "frontend despite corrupt session DB")
                time.sleep(0.4)
                assert process.poll() is None, "Corrupt DB crashed the native app"
                assert corrupt_db.read_bytes() == corrupt_bytes, "Corrupt DB was overwritten"
            print("PASS: corrupt session database does not prevent native startup and original bytes remain intact")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    main()
