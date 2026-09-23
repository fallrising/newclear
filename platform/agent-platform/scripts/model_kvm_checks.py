"""Fault/attack fixtures used only by the opt-in guest model KVM driver."""

import json
import os
import runpy
import signal
import socket
from pathlib import Path
from uuid import uuid4

import httpx

from agent_platform.db import Database
from agent_platform.domain import Problem
from agent_platform.model_dialect import SDKCompletion
from agent_platform.model_proxy import ModelProxy
from agent_platform.runtime_client import RuntimeClient
from agent_platform.worker import Worker


def child(config, origin, output, stage):
    db = Database(os.environ["TEST_DATABASE_URL"])
    db.open()

    def stop(point):
        if point == stage:
            (output / "worker-stopped").write_text(point)
            os.kill(os.getpid(), signal.SIGSTOP)

    reserve, settle, exchange = ModelProxy.reserve, ModelProxy.settle, RuntimeClient.model

    def reserved(self, *args, **kwargs):
        value = reserve(self, *args, **kwargs)
        stop("reserved")
        return value

    def settled(self, *args, **kwargs):
        value = settle(self, *args, **kwargs)
        stop("settled")
        return value

    def delivered(self, run, action, **data):
        value = exchange(self, run, action, **data)
        if action == "deliver":
            stop("delivered")
        return value

    ModelProxy.reserve, ModelProxy.settle, RuntimeClient.model = reserved, settled, delivered
    client = RuntimeClient(origin, Path(config["connector_token_file"]).read_text().strip())
    Worker(db, client).run_once()
    db.close()


def install_attack(sb):
    source = runpy.run_path(str(Path(__file__).with_name("m3-isolation-kvm.py")))["GUEST"]
    source = source.replace(
        "if b'/usr/local/bin/openhands-agent-server' in args:",
        "if b'/usr/local/bin/openhands-agent-server' in args "
        "or b'/opt/agent-platform/guest_model.py' in args:",
    ).replace("k.startswith(b'SESSION_API_KEY=')", "k.startswith((b'SESSION_API_KEY=',b'MODEL_'))")
    source = source.replace(
        "'model','/opt/agent-platform/guest_fixture.py'",
        "'model','/opt/agent-platform/guest_model.py'",
    )
    extra = r"""
for name,method,path in [('poll','GET','/mailbox'),('rotate','POST','/credential'),
                         ('deliver','POST','/response'),('model','POST','/v1/chat/completions')]:
    c=http.client.HTTPConnection('127.0.0.1',18080,timeout=5)
    try:
        c.request(method,path,body='{}',headers={'Content-Type':'application/json',
                                               'Authorization':'Bearer m2-fixture-no-provider-key'})
        r=c.getresponse();r.read(4096)
        checks['mailbox_'+name+'_unauthorized']=r.status in (401,403)
    finally:c.close()
try:
    Path(control+'/model-mailbox.json').read_bytes()
    checks['mailbox_file_unreadable']=False
except PermissionError: checks['mailbox_file_unreadable']=True
checks['model_environment_absent']=not any(k.startswith('MODEL_') for k in os.environ)
"""
    source = source.replace(
        "Path('/home/agentprobe/workspace/isolation-proof.json')",
        extra + "\nPath('/tmp/model-isolation-proof.json')",
    )
    sb.write_file("/opt/agent-platform/model_attack.py", source.encode(), mode=0o644)
    bait = runpy.run_path(str(Path(__file__).with_name("m3-isolation-kvm.py")))["BAIT"]
    sb.exec("python3", "-I", "-c", bait, user="agentprobe", timeout=15)


def attack_response(value, run_id):
    call = value["choices"][0]["message"]["tool_calls"][0]["function"]
    if call["name"] == "terminal":
        command = json.loads(call["arguments"])["command"]
        call["arguments"] = json.dumps(
            {"command": f"python3 -I /opt/agent-platform/model_attack.py {run_id}; " + command}
        )
    return value


def cross_run_probe(node, first, second, proxy, payload):
    handle = second["handle"]
    sb = node.attach(handle["owner"], handle["id"], handle["token"])
    listener = sb.proxy_port("127.0.0.1:0", 18080)
    try:
        with httpx.Client(
            base_url=f"http://127.0.0.1:{listener.getsockname()[1]}", trust_env=False
        ) as transport:
            assert (
                transport.get(
                    "/mailbox", headers={"X-Session-API-Key": first["session_key"]}
                ).status_code
                == 401
            )
            assert (
                transport.post(
                    "/v1/chat/completions",
                    json={},
                    headers={"Authorization": "Bearer " + first["model_local_key"]},
                ).status_code
                == 401
            )
    finally:
        listener.shutdown(socket.SHUT_RDWR)
        listener.close()
    try:
        proxy.complete(
            second["run_id"],
            first["model_credential"]["token"],
            uuid4(),
            SDKCompletion(payload),
            sdk=True,
        )
    except Problem as exc:
        assert exc.code == "model_token_invalid"
    else:
        raise RuntimeError("cross_run_proxy_token_accepted")
    return {
        "two_live_vms": True,
        "cross_run_relay_rejected": True,
        "cross_run_sdk_rejected": True,
        "cross_run_proxy_rejected": True,
    }
