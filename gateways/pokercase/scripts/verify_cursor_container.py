#!/usr/bin/env python3
"""Manual, credential-free integration probe of the actual thinrouter Docker runner.
Requires an already available Python image; never pulls or calls a model provider.
"""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

FAKE = r'''#!/usr/local/bin/python3
import json, os, pathlib, re, sys, time
prompt = sys.argv[-1]
def out(v):
    print(json.dumps(v), flush=True)
if "FAIL_CANARY" in prompt:
    sys.stderr.write("PRIVATE-STDERR-CANARY\n")
    sys.exit(1)
if "HOLD_CANARY" in prompt:
    out({"type":"assistant","timestamp_ms":1,"message":{"content":[{"type":"text","text":"holding"}]}})
    time.sleep(60)
    sys.exit(0)
canary = pathlib.Path(re.search(r"CANARY=(\S+)", prompt).group(1))
try:
    canary.read_text()
    host_read = True
except OSError:
    host_read = False
try:
    pathlib.Path(str(canary)+"-write").write_text("bad")
    host_write = True
except OSError:
    host_write = False
try:
    pathlib.Path("/workspace/probe").write_text("allowed")
    workspace_write = True
except OSError:
    workspace_write = False
try:
    pathlib.Path("/rootfs-write-canary").write_text("bad")
    root_write = True
except OSError:
    root_write = False
root_ro = any(parts[1] == "/" and "ro" in parts[3].split(",") for parts in (line.split() for line in pathlib.Path("/proc/mounts").read_text().splitlines()))
checks = {"uid":os.getuid(),"host_read":host_read,"host_write":host_write,"host_env": "HOST_SECRET_CANARY" in os.environ,"docker_socket":pathlib.Path("/var/run/docker.sock").exists(),"root_readonly":root_ro,"workspace_write":workspace_write,"root_write":root_write}
out({"type":"result","result":json.dumps(checks),"usage":{"inputTokens":1,"outputTokens":1}})
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--base-image", required=True,
                        help="Existing local image with /usr/local/bin/python3; no pull")
    args = parser.parse_args()
    binary = args.binary.resolve()
    docker = ["docker", "--host=unix:///var/run/docker.sock"]
    suffix = uuid.uuid4().hex
    tag = "thinrouter-cursor-probe:" + suffix
    volume = "thinrouter-cursor-probe-" + suffix
    gateway = None
    image_id = None

    def run(*parts, **kwargs):
        return subprocess.run(docker + list(parts), check=True, timeout=60,
                              text=True, capture_output=True, **kwargs).stdout.strip()

    def containers():
        return run("ps", "-aq", "--filter", "ancestor=" + image_id).split()

    def cleaned():
        for _ in range(100):
            if not containers():
                return
            time.sleep(0.1)
        raise AssertionError("request container not removed")

    try:
        run("image", "inspect", args.base_image)
        with tempfile.TemporaryDirectory(prefix="thinrouter-canary-") as raw:
            root = Path(raw)
            (root / "probe").write_text(FAKE)
            (root / "probe").chmod(0o755)
            # Dockerfile ADD/COPY only: no RUN/network, auth or host home contents.
            (root / "Dockerfile").write_text(
                "FROM " + args.base_image + "\nCOPY probe /probe\n")
            run("build", "--pull=false", "--network=none", "-t", tag, str(root))
            image_id = run("image", "inspect", tag, "--format", "{{.Id}}")
            canary = root / "host-only-canary"
            canary.write_text(uuid.uuid4().hex)
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            env = os.environ.copy()
            for key in list(env):
                if key.startswith("THINROUTER_"):
                    del env[key]
            env["HOST_SECRET_CANARY"] = uuid.uuid4().hex
            gateway = subprocess.Popen([
                str(binary), "serve", "--port", str(port), "--data-dir", str(root / "data"),
                "--cursor-accept-account-plugins", "--cursor-image", image_id,
                "--cursor-profile-volume", volume, "--cursor-bin", "/probe"],
                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            base = f"http://127.0.0.1:{port}"
            for _ in range(100):
                try:
                    with opener.open(base + "/health", timeout=1):
                        break
                except (OSError, urllib.error.URLError):
                    if gateway.poll() is not None:
                        raise AssertionError("gateway exited during startup")
                    time.sleep(0.05)
            else:
                raise AssertionError("gateway did not become healthy")
            admin = (root / "data/admin-token").read_text().strip()

            def post(path, body, headers):
                request = urllib.request.Request(base + path, json.dumps(body).encode(),
                    {"Content-Type":"application/json", **headers})
                return opener.open(request, timeout=15)

            admin_header = {"x-admin-token":admin}
            with post("/admin/api/connections/oauth/import", {"name":"cu","provider":"cursor","access_token":"","default_model":"auto"}, admin_header):
                pass
            with post("/admin/api/keys", {"name":"probe"}, admin_header) as response:
                key = json.load(response)["secret"]
            auth = {"Authorization":"Bearer " + key}

            def request(prompt, stream=False):
                return post("/v1/chat/completions", {"model":"cu","stream":stream,
                    "messages":[{"role":"user","content":prompt}]}, auth)

            with request("CANARY=" + str(canary)) as response:
                checks = json.loads(json.load(response)["choices"][0]["message"]["content"])
            expected = {"uid":1000,"host_read":False,"host_write":False,
                        "host_env":False,"docker_socket":False,
                        "root_readonly":True,"workspace_write":True,"root_write":False}
            assert checks == expected, checks
            assert not Path(str(canary) + "-write").exists()
            cleaned()
            try:
                request("FAIL_CANARY")
                raise AssertionError("failed fake CLI returned success")
            except urllib.error.HTTPError as error:
                assert error.code >= 400
                assert b"PRIVATE-STDERR-CANARY" not in error.read()
            cleaned()
            with request("HOLD_CANARY", stream=True) as response:
                assert response.read(1)
            cleaned()
            print("PASS: actual runner denied host read/write/env/socket; rootfs read-only, uid1000, workspace writable; success/error/cancel cleaned")
    finally:
        if gateway is not None:
            gateway.terminate()
            try:
                gateway.wait(timeout=5)
            except subprocess.TimeoutExpired:
                gateway.kill()
                gateway.wait(timeout=5)
        if image_id is not None:
            for ident in containers():
                run("rm", "-f", ident)
            run("image", "rm", tag)
            # Only this probe's fresh, unique volume is removed.
            run("volume", "rm", "-f", volume)


if __name__ == "__main__":
    main()
