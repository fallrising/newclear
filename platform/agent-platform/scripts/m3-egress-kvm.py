#!/usr/bin/env python3
"""Opt-in real terminal egress acceptance; dedicated empty sealed-policy node only.

Public example.com/httpbin.org and DNS-to-private fixtures are test allow rules,
not a deployment recommendation. Reports contain only booleans/statuses/hashes.
"""

import argparse
import copy
import fcntl
import json
import os
import socket
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from cocoonsandbox import APIError

from agent_platform.connector import Allocate, Connector, Mutation
from agent_platform.connector_fence import Lease
from agent_platform.connector_isolation import CODE, CONTROL
from agent_platform.connector_journal import private_file
from agent_platform.connector_recovery import stopped
from agent_platform.domain import Problem
from agent_platform.egress_node import SEALS, attest, drained

GUEST = r"""
import http.client,json,os,socket,ssl,urllib.request,urllib.error
from pathlib import Path
checks={}
def fetch(url,method='GET',tls=False,host='example.com',port=443):
    if tls:
        c=http.client.HTTPSConnection('127.0.0.1',3128,timeout=15,
                                      context=ssl.create_default_context())
        c.set_tunnel(host,port)
    else: c=http.client.HTTPConnection('127.0.0.1',3128,timeout=15)
    try:
        c.request(method,url);r=c.getresponse();data=r.read(1048576)
        return r.status,data
    finally: c.close()
def denied(url,method='GET',status=403):
    return fetch(url,method)[0]==status
checks['terminal_uid_2000']=os.getuid()==2000
checks['proxy_environment']=all(os.environ.get(k)=='http://127.0.0.1:3128'
                              for k in ['http_proxy','https_proxy'])
checks['no_guest_nic']=set(os.listdir('/sys/class/net'))<={'lo','sit0'}
for key,address in [('direct_public',('1.1.1.1',443)),
                    ('direct_metadata',('169.254.169.254',80)),
                    ('direct_private',('10.0.0.1',80))]:
    try: c=socket.create_connection(address,2);c.close();checks[key+'_blocked']=False
    except OSError: checks[key+'_blocked']=True
checks['socks_disabled']=False
try:
    c=socket.create_connection(('127.0.0.1',1080),2);c.settimeout(2)
    c.sendall(bytes([5,1,0]));checks['socks_disabled']=c.recv(2)!=bytes([5,0]);c.close()
except OSError: checks['socks_disabled']=True
if DENY_ALL:
    checks['previous_http_grant_revoked']=denied('http://example.com/')
    checks['previous_connect_grant_revoked']=denied('example.com:443','CONNECT')
else:
    status,data=fetch('http://example.com/')
    checks['allowed_http']=status==200 and b'Example Domain' in data
    status,data=fetch('/',tls=True)
    checks['allowed_https_connect']=status==200 and b'Example Domain' in data
    with urllib.request.urlopen('https://example.com/',timeout=15) as r:
        checks['automatic_proxy_environment']=r.status==200 and b'Example Domain' in r.read()
    checks['unlisted_domain']=denied('http://denied.invalid/')
    checks['domain_suffix_confusion']=denied('http://example.com.denied.invalid/')
    checks['unlisted_port']=denied('http://example.com:81/')
    checks['unlisted_method']=denied('http://example.com/','POST')
    checks['connect_unlisted_port']=denied('example.com:80','CONNECT')
    checks['connect_unlisted_host']=denied('denied.invalid:443','CONNECT')
    for key,url in [('metadata','http://169.254.169.254/latest/meta-data/'),
                    ('private','http://10.0.0.1/'),('cgnat','http://100.100.100.200/'),
                    ('loopback','http://127.0.0.1:7788/v1/info'),
                    ('ipv6_loopback','http://[::1]/'),
                    ('ipv6_mapped','http://[::ffff:127.0.0.1]/')]:
        checks[key+'_denied']=denied(url)
    # These hostnames ARE allowed. 502 proves the independent resolved-IP dial guard,
    # unlike the literal-address rule denials above. No private upstream is contacted.
    for key,host in [('loopback','localtest.me'),
                     ('metadata','169.254.169.254.sslip.io'),('private','10.0.0.1.sslip.io')]:
        checks['dns_'+key+'_blocked']=denied('http://'+host+'/',status=502)
        checks['dns_'+key+'_connect_blocked']=denied(host+':443','CONNECT',status=502)
    # Follow real redirects: each hop must re-enter the proxy policy/dial guard.
    from urllib.parse import urlencode
    for key,destination,expected in [
        ('allow','https://example.com/',200),('unlisted','http://denied.invalid/',403),
        ('metadata','http://169.254.169.254/latest/meta-data/',403),
        ('dns_private','http://localtest.me/',502)]:
        path='/redirect-to?'+urlencode({'url':destination})
        c=http.client.HTTPSConnection('127.0.0.1',3128,timeout=15,
                                      context=ssl.create_default_context())
        c.set_tunnel('httpbin.org',443)
        try:
            c.request('GET',path);r=c.getresponse();r.read(1048576)
            checks['redirect_'+key+'_origin_302']=(
                r.status==302 and r.getheader('Location')==destination)
        finally: c.close()
        url='https://httpbin.org'+path
        try:
            with urllib.request.urlopen(url,timeout=20) as r:
                code=r.status;r.read(1048576)
        except urllib.error.HTTPError as e: code=e.code
        checks['redirect_'+key]=code==expected
Path('/home/agentprobe/workspace/egress-proof.json').write_text(json.dumps(checks))
"""


def require(value, message):
    if not value:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--deny-all", action="store_true")
    args = parser.parse_args()
    config = json.loads(private_file(args.config).read_text())
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    service = Connector(config)
    require(not service.host.vms() and not service.client.sandboxes(), "node_not_empty")
    require(all(p["target"] == 0 for p in service.client.info()["pools"]), "not_zero_warm")
    proof = attest(config)
    run_id = str(uuid4())
    done = threading.Event()

    def fence():
        service.fences.grant(
            run_id, Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=30))
        )

    def renew():
        while not done.wait(5):
            fence()

    renewer = threading.Thread(target=renew, daemon=True)
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "scope": "node-egress-v1",
        "deny_all": args.deny_all,
        "passed": False,
        "full_at07_complete": False,
        "policy_sha256": proof["policy_sha256"],
    }
    try:
        if not args.deny_all:
            for host, expected in {
                "localtest.me": {"127.0.0.1", "::1"},
                "169.254.169.254.sslip.io": {"169.254.169.254"},
                "10.0.0.1.sslip.io": {"10.0.0.1"},
            }.items():
                answers = {r[4][0] for r in socket.getaddrinfo(host, 80, type=socket.SOCK_STREAM)}
                require(answers == expected, "dns_fixture_changed")
            report["dns_fixture_answers_confirmed"] = True
        fence()
        renewer.start()
        repo = config["repositories"][0]
        service.allocate(
            run_id,
            Allocate(
                egress_policy_sha256=service.network()["policy_sha256"],
                generation=1,
                template=config["template"],
                canonical_repo=repo["canonical_repo"],
                base_sha=repo["base_sha"],
                deadline=datetime.now(UTC) + timedelta(seconds=420),
            ),
        )
        try:
            service.client._request(
                service.client.addr,
                "PUT",
                "/v1/pools",
                {
                    "pools": [
                        {
                            "template": config["template"],
                            "net": "none",
                            "size": "large",
                            "warm": 0,
                            "egress": {"allow": []},
                        }
                    ]
                },
                "egress acceptance",
            )
        except APIError as exc:
            require(exc.status == 400, "unexpected_policy_update_status")
            report["live_policy_api_rejected"] = True
        else:
            raise RuntimeError("live_policy_update_accepted")
        service.mutate(run_id, Mutation(generation=1, action="prepare"))
        row = service.journal.read(run_id)
        sb = service.handle(row)
        sb.write_file(
            CODE + "/egress_probe.py",
            ("DENY_ALL = " + repr(args.deny_all) + "\n" + GUEST).encode(),
            mode=0o644,
        )
        sb.exec(
            "python3",
            "-I",
            "-c",
            "import os,signal;from pathlib import Path;"
            "[(os.kill(int(p.name),signal.SIGTERM)) for p in Path('/proc').iterdir() "
            "if p.name.isdigit() and (p/'cmdline').exists() "
            "and b'/opt/agent-platform/guest_fixture.py' "
            "in (p/'cmdline').read_bytes().split(bytes([0]))]",
            timeout=15,
        )
        source = (
            Path("src/agent_platform/guest_fixture.py")
            .read_text()
            .replace(
                "class Handler(",
                "COMMAND = "
                + repr(f"python3 -I {CODE}/egress_probe.py; ")
                + " + COMMAND\n\nclass Handler(",
            )
        )
        sb.write_file(CODE + "/egress_fixture.py", source.encode(), mode=0o644)
        sb.spawn(
            "python3",
            "-I",
            CODE + "/egress_fixture.py",
            user="agentcontrol",
            cwd=CONTROL,
            env={"FIXTURE_RUN_ID": run_id},
        )
        sb.exec(
            "python3",
            "-I",
            "-c",
            "import socket,time\nfor _ in range(50):\n try:\n"
            "  s=socket.create_connection(('127.0.0.1',18080),.2);s.close();break\n"
            " except OSError: time.sleep(.1)\nelse: raise RuntimeError('model_not_ready')\n",
            timeout=10,
        )
        service.mutate(run_id, Mutation(generation=1, action="prompt", goal="Egress acceptance"))
        deadline = time.monotonic() + 200
        while True:
            events = service.events(run_id, 1, None)
            if events["state"] == "finished" and events["caught_up"]:
                break
            require(time.monotonic() < deadline, "agent_did_not_finish")
            time.sleep(0.3)
        checks = json.loads(
            sb.exec("cat", "/home/agentprobe/workspace/egress-proof.json", timeout=5)
        )
        report["guest_checks"] = checks
        require(
            len(checks) == (9 if args.deny_all else 36) and all(checks.values()),
            "guest_egress_check_failed",
        )
        result = service.mutate(run_id, Mutation(generation=1, action="result"))
        require(result["verification"]["status"] == "passed", "fixture_result_failed")
        # The node cannot be reconfigured while an owned VM exists.
        try:
            drained(config, service.host)
        except Problem:
            report["active_vm_blocks_policy_change"] = True
        else:
            raise RuntimeError("active_node_drain_accepted")
        receipt = json.loads(private_file(config["egress_receipt_file"]).read_text())
        fd = os.open(f"/proc/{receipt['identity']['pid']}/fd/{receipt['config_fd']}", os.O_RDWR)
        try:
            require(fcntl.fcntl(fd, fcntl.F_GET_SEALS) == SEALS, "missing_seals")
            try:
                os.pwrite(fd, b"{}", 0)
            except PermissionError:
                report["live_config_mutation_denied"] = True
            else:
                raise RuntimeError("mutable_node_config")
        finally:
            os.close(fd)
        # A changed desired policy must not bless this node/run. Cancel still works below.
        changed = copy.deepcopy(config["egress_policy"])
        changed["allow"] = (
            [] if changed["allow"] else [{"host": "example.com", "methods": ["GET"], "ports": [80]}]
        )
        service.config = {**config, "egress_policy": changed}
        try:
            service.network(service.journal.read(run_id))
        except Problem:
            report["changed_policy_admission_denied"] = True
        else:
            raise RuntimeError("changed_policy_accepted")
        report["passed"] = True
    finally:
        accepted, report["passed"] = report["passed"], False
        try:
            fence()
            cleanup = service.cancel(run_id, 1)
            report["cleanup_confirmed"] = cleanup.get(
                "observed_state"
            ) == "not_allocated" or stopped(cleanup)
            report["remaining_claims"] = len(service.client.sandboxes())
            report["remaining_vms"] = len(service.host.vms())
            require(
                report["cleanup_confirmed"]
                and not report["remaining_claims"]
                and not report["remaining_vms"],
                "cleanup_incomplete",
            )
            report["passed"] = accepted
        finally:
            done.set()
            if renewer.ident:
                renewer.join(timeout=10)
            service.close()
            report["finished_at"] = datetime.now(UTC).isoformat()
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
