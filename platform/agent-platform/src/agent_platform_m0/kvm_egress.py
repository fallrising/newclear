"""Opt-in no-NIC proxy acceptance against the documented dedicated-node fixture.

The fixture allows example.com on 80/443 (GET/CONNECT) and deliberately allows
127.0.0.1:18999 at the host-rule layer to test the independent IP guard. A
synthetic m0-canary secret is injected on the public plaintext GET. No private
IP override is permitted. The local control HTTP server proves the private
endpoint is reachable before verifying that the guest cannot reach it.
"""

import argparse
import hashlib
import http.client
import json
import os
import re
import threading
import uuid
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .kvm_lifecycle import Host, require
from .sandbox_client import SingleNodeClient
from .sandbox_smoke import Config
from .transport import ProbeError

GUEST = r"""
import hashlib,http.client,json,os,re,ssl,sys
from pathlib import Path
settings=json.load(sys.stdin)
hashes=set(settings['secret_hashes'])
def contains_secret(data):
    return any(hashlib.sha256(v).hexdigest() in hashes
               for v in re.findall(rb'(?=([A-Za-z0-9_-]{64}))', data))
def fetch(target,method='GET',tls=False):
    if tls:
        c=http.client.HTTPSConnection('127.0.0.1',3128,timeout=10,
                                      context=ssl.create_default_context())
        c.set_tunnel('example.com',443)
    else:
        c=http.client.HTTPConnection('127.0.0.1',3128,timeout=10)
    try:
        c.request(method,target,headers={'X-M0-Canary':'guest-cannot-set-secret'})
        response=c.getresponse();data=response.read(1048576)
        return {'status':response.status,'example_body':b'Example Domain' in data,
                'secret_returned':contains_secret(data)}
    finally:
        c.close()
out={}
out['allowed_http']=fetch('http://example.com/')
out['allowed_https']=fetch('/',tls=True)
for label,url,method in [
    ('unlisted_host','http://denied.invalid/','GET'),
    ('metadata','http://169.254.169.254/latest/meta-data/','GET'),
    ('private_network','http://10.0.0.1/','GET'),
    ('control_plane','http://127.0.0.1:7777/v1/info','GET'),
    ('unlisted_port','http://example.com:8000/','GET'),
    ('unlisted_method','http://example.com/','HEAD'),
    ('allowlisted_loopback_ip_guard','http://127.0.0.1:18999/','GET'),
]:
    out[label]=fetch(url,method)
files=skipped=matches=0
for root in ['/home/agentprobe','/tmp','/var/log']:
    for directory,dirs,names in os.walk(root,followlinks=False):
        for name in names:
            p=Path(directory)/name
            try:
                if p.is_symlink() or not p.is_file() or p.stat().st_size>5*1024*1024:
                    skipped+=1;continue
                data=p.read_bytes();files+=1
                matches+=int(contains_secret(data))
            except OSError:
                skipped+=1
out['secret_scan']={'files_scanned':files,'files_skipped':skipped,
                    'file_matches':matches,
                    'environment_matches':sum(contains_secret(v.encode())
                                              for v in os.environ.values())}
print(json.dumps(out))
"""


def run(args):
    Config(args.origin, args.template).validate()
    token = os.environ[args.token_env]
    require(bool(re.fullmatch(r"[A-Za-z0-9_-]{64}", token)), "fixture_requires_64_char_token")
    require(bool(re.fullmatch(r"[a-f0-9]{64}", args.canary_sha256)), "invalid_canary_digest")
    client = SingleNodeClient(args.origin, token)
    host = Host(args.cocoon_config, args.sandbox_data_dir)
    require(not host.vms() and not client.sandboxes(), "dedicated_node_must_be_empty")
    config = json.loads(args.sandbox_config.read_text())
    require(not config.get("egress_internal_allow"), "internal_address_exception_forbidden")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "template": args.template,
        "network_lane": "none",
        "full_m0_complete": False,
    }
    control_requests = []

    class Control(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            control_requests.append(True)
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

    server = ThreadingHTTPServer(("127.0.0.1", 18999), Control)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    sb = observed = None
    claim_ref = "m0-egress-" + uuid.uuid4().hex
    try:
        conn = http.client.HTTPConnection("127.0.0.1", 18999, timeout=3)
        conn.request("GET", "/")
        require(conn.getresponse().read() == b"ok", "private_endpoint_control_failed")
        conn.close()
        require(len(control_requests) == 1, "private_control_request_missing")
        sb = client.new(
            args.template, net="none", size="large", ttl_seconds=180, claim_ref=claim_ref
        )
        observed = host.observe(sb.id)
        results = json.loads(
            sb.exec(
                "python3",
                "-c",
                GUEST,
                stdin=json.dumps(
                    {
                        "secret_hashes": [
                            hashlib.sha256(token.encode()).hexdigest(),
                            args.canary_sha256,
                        ]
                    }
                ).encode(),
                timeout=90,
            )
        )
        report["guest_results"] = results
        for name in ("allowed_http", "allowed_https"):
            require(results[name]["status"] == 200, name + "_failed")
            require(results[name]["example_body"], name + "_wrong_content")
        for name in (
            "unlisted_host",
            "metadata",
            "private_network",
            "control_plane",
            "unlisted_port",
            "unlisted_method",
        ):
            require(results[name]["status"] == 403, name + "_not_denied")
        require(results["allowlisted_loopback_ip_guard"]["status"] == 502, "ip_guard_status")
        require(len(control_requests) == 1, "private_endpoint_was_reached")
        require(not any(v.get("secret_returned") for v in results.values()), "secret_in_response")
        scan = results["secret_scan"]
        require(scan["files_scanned"] > 0, "empty_secret_scan")
        require(scan["file_matches"] == scan["environment_matches"] == 0, "guest_secret_found")
        events = [
            json.loads(line)
            for line in (args.sandbox_data_dir / "audit.jsonl").read_text().splitlines()
        ]
        events = [r for r in events if r.get("op") == "egress" and r.get("id") == sb.id]
        report["egress_audit"] = events
        require(any(r.get("secret") == "m0-canary" for r in events), "no_injection_audit")
        report["private_endpoint_requests"] = len(control_requests)
        report["checks_passed"] = True
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = type(exc).__name__
        if isinstance(exc, ProbeError):
            report["error"] = str(exc)
    finally:
        try:
            if sb is not None:
                sb.close()
            else:
                for row in client.sandboxes():
                    if row.get("claim_ref") == claim_ref:
                        client._request(
                            client.addr,
                            "POST",
                            f"/v1/sandboxes/{row['id']}/release",
                            None,
                            "operator cleanup",
                        )
            if observed:
                report["vm_removal"] = host.wait_removed(observed)
            require(not host.vms() and not client.sandboxes(), "node_not_empty_after_cleanup")
            report["cleanup_passed"] = True
        except Exception:
            report["cleanup_passed"] = False
        server.shutdown()
        server.server_close()
        thread.join()
        report["egress_passed"] = bool(report.get("checks_passed") and report["cleanup_passed"])
        report["finished_at"] = datetime.now(UTC).isoformat()
        fd = os.open(args.output / "report.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--template", required=True)
    parser.add_argument("--cocoon-config", type=Path, required=True)
    parser.add_argument("--sandbox-data-dir", type=Path, required=True)
    parser.add_argument("--sandbox-config", type=Path, required=True)
    parser.add_argument(
        "--canary-sha256", required=True, help="Digest only; never pass the canary value"
    )
    parser.add_argument("--token-env", default="SANDBOX_API_TOKEN")
    parser.add_argument("--output", type=Path, required=True)
    report = run(parser.parse_args())
    print(json.dumps(report, indent=2))
    return 0 if report["egress_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
