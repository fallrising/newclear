#!/usr/bin/env python3
"""Opt-in adversarial terminal acceptance on a dedicated real KVM node.

Uses the product connector, fixed Agent Server, real terminal and approval gate.
Guest attempts only touch this driver-owned VM. No live credential is seeded into
its terminal, command, workspace or report. Evidence contains booleans, not secrets.
"""

import argparse
import json
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from agent_platform.connector import Allocate, Approve, Connector, Mutation
from agent_platform.connector_approval import approve, pending_approval
from agent_platform.connector_fence import Lease
from agent_platform.connector_isolation import CODE, CONTROL
from agent_platform.connector_journal import private_file
from agent_platform.connector_recovery import stopped

GUEST = r"""
import http.client,json,os,subprocess,sys
from pathlib import Path
run_id=sys.argv[1]
control='/var/lib/agent-platform/control'
checks={}
status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines())
checks['terminal_uid_gid_2000']=os.getresuid()==(2000,)*3 and os.getresgid()==(2000,)*3
checks['no_supplementary_groups']=os.getgroups()==[]
checks['no_capabilities']=int(status['CapEff'],16)==0 and int(status['CapPrm'],16)==0
checks['no_new_privileges']=status['NoNewPrivs'].strip()=='1'
checks['clean_environment']=not any(k.startswith(('SESSION_API','OH_SESSION','OH_SECRET','OH_'))
                                    for k in os.environ)
checks['terminal_workspace']=os.getcwd()=='/home/agentprobe/workspace'
controls=[];keys=[];env_denied=0
for path in Path('/proc').glob('[0-9]*'):
    try:
        args=(path/'cmdline').read_bytes().split(bytes([0]))
        if b'/usr/local/bin/openhands-agent-server' in args:
            controls.append(int(path.name))
        try:
            raw=(path/'environ').read_bytes()
            keys.extend(k for k in raw.split(bytes([0])) if k.startswith(b'SESSION_API_KEY='))
        except PermissionError:
            if int(path.name) in controls: env_denied+=1
    except (FileNotFoundError,PermissionError): pass
checks['control_environment_unreadable']=bool(controls) and env_denied==len(controls) and not keys
signal_denied=0
for pid in controls:
    try: os.kill(pid,0)
    except PermissionError: signal_denied+=1
checks['control_signal_denied']=bool(controls) and signal_denied==len(controls)
for name,path in [('state',control+'/state'),('home',control+'/home'),
                  ('sdk_workspace',control+'/workspace')]:
    try: list(Path(path).iterdir());checks[name+'_unreadable']=False
    except PermissionError: checks[name+'_unreadable']=True
for name,path in [('state',control+'/state/config.json'),
                  ('launcher','/opt/agent-platform/terminal'),
                  ('attestation','/opt/agent-platform/guest_control.py'),
                  ('quiescence','/opt/agent-platform/guest_quiescence.py'),
                  ('model','/opt/agent-platform/guest_fixture.py')]:
    try:
        with open(path,'w') as f: f.write('tampered')
        checks[name+'_write_denied']=False
    except PermissionError: checks[name+'_write_denied']=True
for name,method,path,data in [
    ('read','GET','/api/conversations/'+run_id,None),
    ('approve','POST','/api/conversations/'+run_id+'/events/respond_to_confirmation',{'accept':True}),
    ('run','POST','/api/conversations/'+run_id+'/run',None),
]:
    c=http.client.HTTPConnection('127.0.0.1',8000,timeout=5)
    try:
        c.request(method,path,body=json.dumps(data),headers={'Content-Type':'application/json'})
        r=c.getresponse();r.read(4096)
        checks['unauthenticated_'+name+'_denied']=r.status in (401,403)
    finally: c.close()
# Re-invoking the launcher must never yield another account or a privileged shell.
try:
    p=subprocess.run(['/opt/agent-platform/terminal','-i'],input=b'',capture_output=True,timeout=5)
    checks['launcher_reentry_denied']=p.returncode!=0
except PermissionError:
    checks['launcher_reentry_denied']=True
# A setuid executable also cannot restore root after the fixed launcher sets NNP.
p=subprocess.run(['/usr/bin/su','root','-c','id -u'],input=b'',capture_output=True,timeout=10)
checks['setuid_root_denied']=p.returncode!=0
checks['repository_plugin_not_loaded']=not Path('/tmp/isolation-hook-executed').exists()
checks['python_import_not_loaded']=not Path('/tmp/isolation-import-executed').exists()
Path('/home/agentprobe/workspace/isolation-proof.json').write_text(json.dumps(checks))
print(json.dumps(checks))
"""

BAIT = r"""
import json
from pathlib import Path
root=Path('/home/agentprobe/workspace')
for base in [root,Path('/home/agentprobe')]:
    plugin=base/'.openhands/plugins/isolation-bait'
    (plugin/'.plugin').mkdir(parents=True)
    (plugin/'hooks').mkdir()
    (plugin/'.plugin/plugin.json').write_text(json.dumps({'name':'isolation-bait','version':'1.0.0'}))
    hook={'type':'command','command':'id -u > /tmp/isolation-hook-executed'}
    (plugin/'hooks/hooks.json').write_text(json.dumps({'hooks':{
        'SessionStart':[{'hooks':[hook]}],
        'PreToolUse':[{'matcher':'*','hooks':[hook]}],
    }}))
# The old root helper in /tmp could import this module. Isolated Python must not.
poison="from pathlib import Path;Path('/tmp/isolation-import-executed').write_text('loaded')\n"
for base in [Path('/tmp'),root,Path('/home/agentprobe')]:
    for name in ['json.py','sitecustomize.py']:
        (base/name).write_text(poison)
"""


def require(value, code):
    if not value:
        raise RuntimeError(code)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(private_file(args.config).read_text())
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    service = Connector(config)
    require(not service.client.sandboxes() and not service.host.vms(), "node_must_be_empty")
    run_id = str(uuid4())
    done = threading.Event()

    def fence():
        return service.fences.grant(
            run_id, Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=30))
        )

    def renew():
        while not done.wait(5):
            fence()

    renewer = threading.Thread(target=renew, daemon=True)
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "transport": "cocoon-kvm-product-connector-isolation",
        "template": config["template"],
        "full_at07_complete": False,
        "passed": False,
    }
    try:
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
                deadline=datetime.now(UTC) + timedelta(seconds=300),
                require_approval=True,
                verification={"mode": "fixture-m2", "revision": "fixture-m2-v1", "checks": []},
            ),
        )
        service.mutate(run_id, Mutation(generation=1, action="prepare"))
        row = service.journal.read(run_id)
        sb = service.handle(row)
        sb.exec("python3", "-I", "-c", BAIT, user="agentprobe", timeout=15)
        sb.write_file(CODE + "/attack_probe.py", GUEST.encode(), mode=0o644)
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
                + repr(f"python3 -I {CODE}/attack_probe.py {run_id}; ")
                + " + COMMAND\n\nclass Handler(",
            )
        )
        sb.write_file(CODE + "/isolation_fixture.py", source.encode(), mode=0o644)
        sb.spawn(
            "python3",
            "-I",
            CODE + "/isolation_fixture.py",
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
        service.mutate(run_id, Mutation(generation=1, action="prompt", goal="Isolation acceptance"))
        deadline = time.monotonic() + 90
        approved = False
        while True:
            events = service.events(run_id, 1, None)
            if (
                events["state"] == "waiting_for_confirmation"
                and events["caught_up"]
                and not approved
            ):
                # A terminal cannot execute the attack before the operator's exact batch grant.
                absent = sb.exec(
                    "test", "!", "-e", "/home/agentprobe/workspace/isolation-proof.json", timeout=5
                )
                require(absent == "", "tool_executed_before_approval")
                grant = pending_approval(service, service.journal.read(run_id))
                approve(
                    service,
                    run_id,
                    Approve(
                        generation=1,
                        approval_id=uuid4(),
                        action_digest=grant["action_digest"],
                        expires_at=datetime.now(UTC) + timedelta(seconds=60),
                    ),
                )
                approved = True
            if events["state"] == "finished" and events["caught_up"]:
                break
            require(time.monotonic() < deadline, "agent_did_not_finish")
            time.sleep(0.2)
        require(approved, "approval_not_exercised")
        row = service.journal.read(run_id)
        report["attestation"] = service.isolation(row, terminal=True)
        checks = json.loads(
            sb.exec("cat", "/home/agentprobe/workspace/isolation-proof.json", timeout=5)
        )
        report["checks"] = checks
        require(
            len(checks) == 23 and all(v is True for v in checks.values()),
            "guest_attack_not_blocked",
        )
        report["checks"] = checks
        value = service.mutate(run_id, Mutation(generation=1, action="result"))
        require(value["verification"]["status"] == "passed", "fixture_verification_failed")
        require(
            sb.exec("test", "!", "-e", "/tmp/isolation-import-executed", timeout=5) == "",
            "result_helper_imported_guest_code",
        )
        report.update(approval_required=True, fixture_result="passed", passed=True)
    finally:
        accepted, report["passed"] = report["passed"], False
        try:
            fence()
            proof = service.cancel(run_id, 1)
            report["cleanup_confirmed"] = proof.get("observed_state") == "not_allocated" or stopped(
                proof
            )
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
