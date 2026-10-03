#!/usr/bin/env python3
"""Exercise a built prismd with ephemeral loopback ports and a temporary key."""

import argparse
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prismd", required=True, type=Path)
    parser.add_argument("--telemetrygen", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix="prism-otlp-smoke-") as directory:
        temporary = Path(directory)
        key = secrets.token_hex(32)
        key_file = temporary / "ingest-key"
        key_file.write_text(key)
        key_file.chmod(0o600)
        http_port, grpc_port = free_port(), free_port()
        while http_port == grpc_port:
            grpc_port = free_port()
        env = os.environ.copy()
        env.update({
            "PRISM_SERVER_HTTP_LISTEN": f"127.0.0.1:{http_port}",
            "PRISM_SERVER_GRPC_LISTEN": f"127.0.0.1:{grpc_port}",
            "PRISM_SERVER_SHUTDOWN_TIMEOUT": "2s",
            "PRISM_AUTH_INGEST_API_KEY_FILE": str(key_file),
        })
        base = [str(args.prismd.resolve()), "--config", str(root / "internal/config/testdata/prismd.yaml")]
        check = subprocess.run(base + ["--config-check"], env=env, capture_output=True, text=True, timeout=10, check=False)
        if check.returncode or "configuration valid" not in check.stdout + check.stderr:
            raise RuntimeError("prismd config-check failed")
        with (temporary / "daemon.log").open("w+") as log:
            process = subprocess.Popen(base, env=env, stdout=log, stderr=log)
            try:
                endpoint = f"http://127.0.0.1:{http_port}"
                deadline = time.monotonic() + 10
                while True:
                    if process.poll() is not None:
                        raise RuntimeError("daemon exited during startup")
                    try:
                        with urllib.request.urlopen(endpoint + "/-/healthy", timeout=1) as response:
                            if response.status == 200 and response.read(32).strip() == b"ok":
                                break
                    except (urllib.error.URLError, TimeoutError):
                        pass
                    if time.monotonic() >= deadline:
                        raise RuntimeError("daemon health timed out")
                    time.sleep(0.05)
                with urllib.request.urlopen(endpoint + "/metrics", timeout=2) as response:
                    if response.status != 200 or b"go_goroutines" not in response.read(1 << 20):
                        raise RuntimeError("base metrics missing")
                for signal_name in ("metrics", "logs", "traces"):
                    request = urllib.request.Request(endpoint + "/v1/" + signal_name, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
                    try:
                        urllib.request.urlopen(request, timeout=2).close()
                    except urllib.error.HTTPError as error:
                        with error:
                            if error.code != 401:
                                raise RuntimeError("unauthenticated export did not return 401") from error
                    else:
                        raise RuntimeError("unauthenticated export accepted")
                    request.add_header("Authorization", "Bearer " + key)
                    with urllib.request.urlopen(request, timeout=2) as response:
                        if response.status != 200:
                            raise RuntimeError("authenticated export failed")
                        json.loads(response.read(4096))
                # The separate integration test asserts persistence using SPI;
                # this probe establishes the actual daemon's gRPC wiring.
                command = [str(args.telemetrygen.resolve()), "traces", "--traces", "1", "--workers", "1", "--otlp-insecure", "--otlp-endpoint", f"127.0.0.1:{grpc_port}", "--otlp-header", f'authorization="Bearer {key}"']
                generated = subprocess.run(command, capture_output=True, timeout=15, check=False)
                if generated.returncode:
                    raise RuntimeError("telemetrygen could not export through daemon gRPC")
                started = time.monotonic()
                process.send_signal(signal.SIGTERM)
                if process.wait(timeout=5) != 0:
                    raise RuntimeError("daemon SIGTERM did not exit successfully")
                elapsed = time.monotonic() - started
                log.seek(0)
                if key in log.read():
                    raise RuntimeError("daemon leaked ingest credential")
                print(f"PASS config-check, health, metrics, HTTP three-signal auth, gRPC export; SIGTERM exit 0 in {elapsed:.3f}s")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
