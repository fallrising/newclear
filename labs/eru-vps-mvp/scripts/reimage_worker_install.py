"""Single-use worker-only install stage after a manual provider-console reimage.
Interrupted runs are reconciled by observation only; this plan is never replayed.
"""
from datetime import datetime, timezone
import base64, hashlib, ipaddress, json, re, subprocess
from pathlib import Path
from labops import atomic_json, digest, lock_fds
from reimage_host import inspect_replacement_host
from worker_payload import build_worker_payload

PRESERVED_SERVICES = {"ssh.service", "tailscaled.service", "docker.service", "containerd.service"}

POST_FACTS = r'''import json, pathlib, subprocess, shlex
def run(argv):
    p=subprocess.run(argv,capture_output=True,text=True,timeout=20)
    if p.returncode: raise RuntimeError("worker verification command failed")
    return p.stdout.strip()
services={u:run(["systemctl","show","--property=ActiveState","--value",u])
          for u in ["ssh.service","tailscaled.service","docker.service","containerd.service"]}
osr={}
for line in pathlib.Path("/etc/os-release").read_text().splitlines():
    k,sep,v=line.partition("=")
    if sep and k=="PRETTY_NAME":
        parsed=shlex.split(v);osr[k]=parsed[0] if parsed else ""
facts={
 "schema_version":1,"machine_id":pathlib.Path("/etc/machine-id").read_text().strip(),
 "boot_id":pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
 "os_release":osr.get("PRETTY_NAME",""),"tailscale_ipv4":run(["tailscale","ip","-4"]),
 "services":services,
 "runtime_counts":{"containers":len(run(["ctr","--namespace","eru","containers","list","-q"]).splitlines()),
                   "tasks":len(run(["ctr","--namespace","eru","tasks","list","-q"]).splitlines())},
 "docker_containers":run(["docker","ps","-aq"]).splitlines(),
 "docker_version":run(["docker","--version"]),"containerd_version":run(["containerd","--version"]),
 "agent_active_state":run(["systemctl","show","--property=ActiveState","--value","eru-agent.service"]),
 "agent_unit_state":run(["systemctl","show","--property=UnitFileState","--value","eru-agent.service"]),
 "proxy_socket_active_state":run(["systemctl","show","--property=ActiveState","--value","eru-containerd-proxy.socket"]),
 "proxy_socket_unit_state":run(["systemctl","show","--property=UnitFileState","--value","eru-containerd-proxy.socket"]),
 "root_login_prohibited":"permitrootlogin no" in run(["/usr/sbin/sshd","-T"]).splitlines(),
 "owner_manifest_present":pathlib.Path("/var/lib/eru-mvp/owner.json").is_file()}
print(json.dumps(facts,sort_keys=True))
'''

INSTALL_PREFLIGHT = r'''import json, pathlib, pwd, subprocess
def run(argv):
    p=subprocess.run(argv,capture_output=True,text=True,timeout=20)
    if p.returncode: raise RuntimeError("worker install preflight command failed")
    return p.stdout.strip()
def present(path):
    p=pathlib.Path(path);return p.exists() or p.is_symlink()
def safe_parents(path):
    cur=pathlib.Path("/")
    for part in pathlib.Path(path).parts[1:]:
        cur=cur/part
        if cur.is_symlink(): raise RuntimeError("ERU destination has symlink ancestor")
if os.geteuid()!=0: raise RuntimeError("requires root")
pwd.getpwnam("ckc")
if "permitrootlogin no\n" not in run(["/usr/sbin/sshd","-T"]):
    raise RuntimeError("root SSH login must remain prohibited")
if run(["containerd","--version"])!=EXPECTED["containerd_version"]:
    raise RuntimeError("containerd version differs from verified replacement")
if run(["docker","--version"])!=EXPECTED["docker_version"]:
    raise RuntimeError("Docker version differs from verified replacement")
services={u:run(["systemctl","show","--property=ActiveState","--value",u])
          for u in ["ssh.service","tailscaled.service","docker.service","containerd.service"]}
if services!={u:"active" for u in services}: raise RuntimeError("preserved service is inactive")
if run(["ctr","--namespace","eru","containers","list","-q"]): raise RuntimeError("ERU containers exist")
if run(["ctr","--namespace","eru","tasks","list","-q"]): raise RuntimeError("ERU tasks exist")
if run(["docker","ps","-aq"]): raise RuntimeError("Docker workloads exist")
root=pathlib.Path("/var/lib/eru-mvp")
if root.is_symlink() or (root.exists() and not root.is_dir()): raise RuntimeError("unsafe ERU owner root")
if root.exists() and (root.stat().st_uid!=0 or root.stat().st_mode&0o077): raise RuntimeError("unsafe ERU owner root mode")
if present("/var/lib/eru-mvp/owner.json"): raise RuntimeError("ERU owner manifest already exists")
if present("/var/lib/eru-mvp/owner.json.tmp"): raise RuntimeError("stale ERU owner journal file exists")
paths=[p for a in EXPECTED["artifacts"] for p in a["files"].values()]
paths += [f["path"] for f in EXPECTED["files"]]
for path in paths:
    safe_parents(path)
    if present(path): raise RuntimeError("ERU install destination already exists")
effective=run(["/usr/sbin/sshd","-T","-C","user=ckc,host="+EXPECTED["core_ip"]+",addr="+EXPECTED["core_ip"]])
key_paths=next(x.split()[1:] for x in effective.splitlines() if x.startswith("authorizedkeysfile "))
if key_paths!=["/etc/ssh/onevps-personal-admin/ckc.keys"]: raise RuntimeError("unreviewed admin key path")
auth=pathlib.Path("/etc/ssh/onevps-personal-admin/ckc.keys")
safe_parents(str(auth))
if auth.is_symlink() or not auth.is_file(): raise RuntimeError("admin key file missing or unsafe")
st=auth.stat()
if st.st_uid!=0 or st.st_mode&0o022: raise RuntimeError("unsafe admin key file mode")
lines=auth.read_text().splitlines()
if EXPECTED["authorized_key"] not in lines and any("eru-vps-mvp-core" in x for x in lines):
    raise RuntimeError("different ERU core key exists; rotation review required")
print(json.dumps({"schema_version":1,"services":services,"runtime_counts":{"containers":0,"tasks":0},
 "docker_containers":[],"owner_manifest_present":False,"install_destinations_absent":True,
 "authorized_key_path_verified":True,"docker_version":EXPECTED["docker_version"],
 "containerd_version":EXPECTED["containerd_version"]},sort_keys=True))
'''

def _now():
    return datetime.now(timezone.utc).isoformat()

def _identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}",value):
        raise ValueError("invalid worker bootstrap plan ID")
    return value

def _read_json(path,label):
    path=Path(path)
    if path.is_symlink() or not path.is_file(): raise ValueError(label+" is missing or unsafe")
    try: raw=path.read_bytes(); data=json.loads(raw)
    except (OSError,json.JSONDecodeError) as exc: raise ValueError(label+" is not valid JSON") from exc
    if not isinstance(data,dict): raise ValueError(label+" is malformed")
    return data,hashlib.sha256(raw).hexdigest()

def _bootstrap(operator,plan_id,expected_hash):
    path=operator.root/"reimage-bootstrap-plans"/(_identifier(plan_id)+".json")
    env,_=_read_json(path,"worker bootstrap plan"); plan=env.get("plan")
    if not isinstance(plan,dict) or digest(plan)!=env.get("sha256") or expected_hash!=env.get("sha256"):
        raise ValueError("worker bootstrap plan hash mismatch")
    if plan.get("id")!=plan_id or plan.get("operation")!="provider-reimage-worker-bootstrap" or plan.get("executable") is not False:
        raise ValueError("plan is not a review-only worker bootstrap plan")
    return plan

def _validated_context(operator,plan_id,expected_hash):
    from labctl import code_inputs,load_inventory
    from reimage_prepare import _load_plan,require_prepared
    from reimage_receipt import load_receipt,verify_local_hostkeys
    from reimage_host import REQUIRED_FACTS,validate_facts
    from reimage_worker_plan import POST_REIMAGE_BLOCKER,WORKER_ACCESS_STEPS,WORKER_INDEX,_safe_json

    plan=_bootstrap(operator,plan_id,expected_hash)
    source=plan.get("source_reimage_plan",{})
    source_plan,host=_load_plan(operator,source.get("id"),source.get("sha256"))
    prep=require_prepared(operator,source_plan,source["sha256"])
    alias,node=host["alias"],source_plan["node"]
    if WORKER_INDEX.get(alias,(None,))[0]!=node:
        raise ValueError("bootstrap target is not a reviewed worker alias/name pair")

    record_path=operator.root/"reimage-receipts"/(source_plan["id"]+".json")
    record,record_sha=_safe_json(record_path,"recorded owner receipt")
    if (record.get("plan_id")!=source_plan["id"] or record.get("plan_sha256")!=source["sha256"]
        or record.get("status")!="owner-receipt-recorded" or record.get("remote_mutation_performed") is not False
        or record.get("preparation")!=prep or record_sha!=plan.get("source_receipt_record_sha256")):
        raise ValueError("owner receipt record changed after worker bootstrap planning")
    receipt=load_receipt(operator.project,record.get("receipt_path",""),plan=source_plan,plan_sha256=source["sha256"])
    if receipt["sha256"]!=record.get("receipt_sha256") or receipt["receipt"]!=record.get("receipt"):
        raise ValueError("owner receipt changed after worker bootstrap planning")
    trusted=verify_local_hostkeys(alias,receipt["receipt"]["host_key_fingerprints"],operator.trusted_hostkeys_dir)
    if trusted!=record.get("trusted_host_key_file_check"):
        raise ValueError("replacement worker trusted host-key file changed")

    obs_path=operator.root/"reimage-observations"/(source_plan["id"]+".json")
    obs_record,obs_record_sha=_safe_json(obs_path,"replacement host observation")
    obs=obs_record.get("observation")
    if (obs_record_sha!=plan.get("source_observation_record_sha256")
        or obs_record.get("plan_id")!=source_plan["id"] or obs_record.get("plan_sha256")!=source["sha256"]
        or obs_record.get("status")!="replacement-host-readonly-verified"
        or obs_record.get("remote_mutation_performed") is not False
        or obs_record.get("receipt_sha256")!=receipt["sha256"]
        or obs_record.get("observation_sha256")!=plan.get("source_observation_sha256")
        or not isinstance(obs,dict) or digest(obs)!=plan["source_observation_sha256"]):
        raise ValueError("replacement host observation changed after bootstrap planning")
    if obs.get("ssh_verified_by_strict_host_key_check") is not True or obs.get("host_key_file_check")!=trusted:
        raise ValueError("replacement host strict SSH trust proof is missing or changed")
    replacement={**receipt["receipt"]["replacement"],
                 "host_key_fingerprints":receipt["receipt"]["host_key_fingerprints"]}
    facts=validate_facts({key:obs.get(key) for key in REQUIRED_FACTS},replacement)
    if facts["machine_id"]==source_plan["provider_reimage_intent"]["target"]["machine_id"]:
        raise ValueError("replacement host machine identity matches the old worker")

    bindings={"inventory":load_inventory(operator.project),"inputs":code_inputs(operator.project),
              "cluster":operator.cluster(),
              "provider_reimage_intent":source_plan["bindings"]["provider_reimage_intent"]}
    if bindings!=source_plan["bindings"] or bindings!=plan.get("bindings"):
        raise ValueError("inventory, generation, intent or pinned inputs changed; create a new reimage plan")
    if plan.get("preparation_summary_sha256")!=prep["summary_sha256"]:
        raise ValueError("worker bootstrap preparation proof changed")
    lock_path=operator.project/"artifacts.amd64.lock.json"; lock_raw=lock_path.read_bytes()
    if hashlib.sha256(lock_raw).hexdigest()!=plan.get("artifacts_lock_sha256"):
        raise ValueError("worker artifact lock changed after bootstrap planning")
    index=WORKER_INDEX[alias][1]
    core_ip=next(row["ip"] for row in bindings["inventory"] if row["role"]=="core")
    payload=build_worker_payload({"alias":alias,"node":node,"index":index,
                                  "ip":facts["tailscale_ipv4"]},core_ip,json.loads(lock_raw))
    repos={item.get("repository") for item in payload.get("artifacts",[])}
    if (plan.get("worker_payload")!=payload or plan.get("worker_payload_sha256")!=digest(payload)
        or payload.get("role")!="worker" or payload.get("start_units")!=["eru-containerd-proxy.socket"]
        or repos!={"projecteru2/agent","containernetworking/plugins"}):
        raise ValueError("bootstrap payload differs from the locked worker-only install scope")
    listed=[{"path":f["path"],"mode":f["mode"],
             "sha256":hashlib.sha256(f["content"].encode()).hexdigest()} for f in payload["files"]]
    if plan.get("worker_files")!=listed: raise ValueError("worker file allowlist or checksum changed")

    old=[row for row in source_plan["snapshot"]["nodes"] if row.get("name")==node]
    if len(old)!=1: raise ValueError("source plan lacks the exact prior worker registration")
    row=old[0]; address=str(ipaddress.ip_address(facts["tailscale_ipv4"]))
    registration={"node":node,"podname":row["podname"],
       "endpoint":"containerd://ckc@"+address+":22","labels":row["labels"],
       "resource_capacity":row["resource_capacity"]}
    if plan.get("registration")!=registration:
        raise ValueError("planned registration differs from prior worker identity and capacity")
    target={"alias":alias,"node":node,"index":index,
       "old_machine_id":source_plan["provider_reimage_intent"]["target"]["machine_id"],
       "machine_id":facts["machine_id"],"boot_id":facts["boot_id"],"os_release":facts["os_release"],
       "tailscale_ipv4":address,"docker_version":facts["docker_version"],
       "containerd_version":facts["containerd_version"]}
    if plan.get("target")!=target: raise ValueError("replacement identity differs from reviewed bootstrap plan")
    gate=plan.get("worker_install")
    if not isinstance(gate,dict) or gate.get("executable") is not True or gate.get("blockers")!=[]:
        raise ValueError("worker install gate is missing or blocked")
    if (plan.get("blockers")!=[POST_REIMAGE_BLOCKER]
        or plan.get("mutation_hosts")!=[operator.core["alias"],alias]):
        raise ValueError("worker bootstrap post-install stage contract changed; create a new plan")
    from core_release import validation_record
    access_gate=plan.get("worker_access")
    if (not isinstance(access_gate,dict) or access_gate.get("executable") is not True
        or access_gate.get("blockers")!=[] or access_gate.get("steps")!=WORKER_ACCESS_STEPS):
        raise ValueError("worker access gate is missing or blocked")
    registration_gate=plan.get("worker_registration")
    if (not isinstance(registration_gate,dict) or registration_gate.get("executable") is not True
        or registration_gate.get("blockers")!=[]
        or registration_gate.get("core_release")!=validation_record(
            operator.project,"patches/core-v0.1.5-safe-node-add.validation.json")):
        raise ValueError("safe worker registration release binding changed; create a new plan")
    return plan,source_plan,receipt,obs,trusted,prep


def _ssh_options(operator,trusted):
    path=(operator.trusted_hostkeys_dir/trusted["path"]).resolve()
    return ["UserKnownHostsFile="+str(path),"GlobalKnownHostsFile=/dev/null","UpdateHostKeys=no"]


def _recorded_runner(operator,alias):
    def runner(argv,*,input=None,capture_output,text,timeout):
        event={"at":_now(),"host":alias,"argv":argv,"status":"started"}
        operator.events.append(event);operator.save_journal()
        try:
            result=subprocess.run(argv,input=input,capture_output=capture_output,text=text,
                                  timeout=timeout,pass_fds=lock_fds())
        except BaseException as exc:
            event.update(status="uncertain",error=type(exc).__name__);operator.save_journal();raise
        event.update(status="complete",exit_code=result.returncode,
                     stdout=result.stdout,stderr=result.stderr)
        operator.save_journal()
        return result
    return runner


def _other_hosts_unchanged(operator,source_plan,target_alias):
    expected=source_plan["snapshot"]["hosts"]
    old_inventory=operator.inventory
    try:
        operator.inventory=[row for row in old_inventory if row["alias"]!=target_alias]
        current=operator.host_snapshot()
    finally:
        operator.inventory=old_inventory
    aliases=set(expected)-{target_alias}
    if set(current)!=aliases: raise ValueError("unrelated host set changed during worker install")
    for alias in aliases:
        if current[alias]!=expected[alias]:
            raise ValueError("unrelated host or runtime state changed: "+alias)


def _cluster_unchanged(operator,source_plan):
    from reimage_prepare import _assert_cluster_state
    _assert_cluster_state(operator,source_plan,target_present=False)

def _check_health(operator):
    health=operator.health()
    if health.get("exit_code")!=0: raise ValueError("control plane health failed; worker install is blocked")
    return health


def _validated_public_key(value):
    rows=[line.strip() for line in str(value).splitlines() if line.strip()]
    if len(rows)!=1: raise ValueError("core did not return exactly one public worker key")
    fields=rows[0].split()
    if len(fields)<2 or fields[0]!="ssh-ed25519": raise ValueError("core worker key is not Ed25519")
    try: blob=base64.b64decode(fields[1],validate=True)
    except ValueError as exc: raise ValueError("core worker public key is malformed") from exc
    if len(blob)<4 or int.from_bytes(blob[:4],"big")!=11 or blob[4:15]!=b"ssh-ed25519":
        raise ValueError("core worker public key has an invalid SSH key blob")
    if len(blob)<19 or int.from_bytes(blob[15:19],"big")!=len(blob)-19 or len(blob[19:])!=32:
        raise ValueError("core worker public key has an invalid Ed25519 key length")
    return "ssh-ed25519 "+fields[1]+(" "+" ".join(fields[2:]) if len(fields)>2 else "")


def _approved_worker_key(operator,raw_key,core_ip):
    key=_validated_public_key(raw_key)
    fields=key.split()
    path=operator.project/"private"/"verified-host-public-keys.json"
    try:
        verified=json.loads(path.read_text())
        approved=verified[operator.core["alias"]]
    except (OSError,json.JSONDecodeError,KeyError,TypeError) as exc:
        raise ValueError("verified core public-key input is missing or malformed") from exc
    if not isinstance(approved,list) or any(not isinstance(item,str) for item in approved):
        raise ValueError("verified core public-key list is malformed")
    identity=" ".join(fields[:2])
    matches=[" ".join(item.split()[:2]) for item in approved if len(item.split())>=2]
    if matches.count(identity)!=1:
        raise ValueError("live core worker key is not uniquely approved by the pinned public-key input")
    return (f'from="{core_ip}",command="/usr/local/libexec/eru-ssh-command",'
            'no-agent-forwarding,no-X11-forwarding,no-pty '+key)


def _read_replacement(operator,alias,receipt,observation,trusted):
    from reimage_host import REQUIRED_FACTS
    current=inspect_replacement_host(alias,receipt["receipt"]["replacement"] |
        {"host_key_fingerprints":receipt["receipt"]["host_key_fingerprints"]},
        operator.trusted_hostkeys_dir,runner=_recorded_runner(operator,alias))
    if current.get("host_key_file_check")!=trusted:
        raise ValueError("replacement host trusted key changed during worker install")
    for name in ("machine_id","boot_id","os_release","tailscale_ipv4","services",
                 "runtime_counts","docker_version","containerd_version"):
        if current.get(name)!=observation.get(name):
            raise ValueError("replacement host "+name.replace("_"," ")+" changed since read-only verification")
    return {key:current[key] for key in sorted(REQUIRED_FACTS)}


def _preflight(operator,plan,key,trusted):
    alias=plan["target"]["alias"]
    config=dict(plan["worker_payload"]);config["authorized_key"]=key
    source="import os\nEXPECTED = "+repr(config)+"\n"+INSTALL_PREFLIGHT
    raw=operator.command(alias,["sudo","-n","python3","-"],source,
                         timeout=90,ssh_options=_ssh_options(operator,trusted))
    try: report=json.loads(raw)
    except (TypeError,json.JSONDecodeError) as exc: raise ValueError("worker install preflight returned invalid JSON") from exc
    required={"schema_version","services","runtime_counts","docker_containers","owner_manifest_present",
              "install_destinations_absent","authorized_key_path_verified","docker_version","containerd_version"}
    if not isinstance(report,dict) or set(report)!=required or report["schema_version"]!=1:
        raise ValueError("worker install preflight schema is invalid")
    if report["services"]!={unit:"active" for unit in PRESERVED_SERVICES}:
        raise ValueError("replacement SSH/Tailscale/Docker/containerd services are not all active")
    if (report["runtime_counts"]!={"containers":0,"tasks":0} or report["docker_containers"]
        or report["owner_manifest_present"] is not False or report["install_destinations_absent"] is not True
        or report["authorized_key_path_verified"] is not True):
        raise ValueError("replacement host is not a clean, empty worker install target")
    for name in ("docker_version","containerd_version"):
        if report[name]!=plan["target"][name]:
            raise ValueError("replacement "+name.replace("_"," ")+" changed since planning")
    return report


def _post_facts(operator,plan,trusted,expected_agent_active="inactive",expected_agent_unit="disabled"):
    alias=plan["target"]["alias"]
    raw=operator.command(alias,["sudo","-n","python3","-"],POST_FACTS,
                         timeout=90,ssh_options=_ssh_options(operator,trusted))
    try: facts=json.loads(raw)
    except (TypeError,json.JSONDecodeError) as exc: raise ValueError("worker install verification returned invalid JSON") from exc
    required={"schema_version","machine_id","boot_id","os_release","tailscale_ipv4","services",
        "runtime_counts","docker_containers","docker_version","containerd_version","agent_active_state",
        "agent_unit_state","proxy_socket_active_state","proxy_socket_unit_state","root_login_prohibited",
        "owner_manifest_present"}
    if not isinstance(facts,dict) or set(facts)!=required or facts["schema_version"]!=1:
        raise ValueError("worker install verification schema is invalid")
    target=plan["target"]
    expected={"machine_id":target["machine_id"],"boot_id":target["boot_id"],
        "os_release":target["os_release"],"tailscale_ipv4":target["tailscale_ipv4"],
        "docker_version":target["docker_version"],"containerd_version":target["containerd_version"]}
    if any(facts.get(k)!=v for k,v in expected.items()):
        raise ValueError("replacement host identity or preserved runtime version changed during install")
    if facts["services"]!={unit:"active" for unit in PRESERVED_SERVICES}:
        raise ValueError("preserved SSH/Tailscale/Docker/containerd service stopped during install")
    if (facts["runtime_counts"]!={"containers":0,"tasks":0} or facts["docker_containers"]
        or facts["proxy_socket_active_state"]!="active" or facts["proxy_socket_unit_state"]!="enabled"
        or facts["root_login_prohibited"] is not True or facts["owner_manifest_present"] is not True):
        raise ValueError("worker install did not leave an empty state with the proxy socket active")
    if ((expected_agent_active is not None and facts["agent_active_state"]!=expected_agent_active)
        or (expected_agent_unit is not None and facts["agent_unit_state"]!=expected_agent_unit)):
        raise ValueError("worker agent service state differs from the expected registration phase")
    if facts["agent_active_state"] not in {"active","inactive"} or facts["agent_unit_state"] not in {"enabled","disabled"}:
        raise ValueError("worker agent service state is unreadable")
    return facts


def _worker_audit(operator,plan,trusted):
    alias,node=plan["target"]["alias"],plan["target"]["node"]
    source=(operator.project/"scripts/worker_scope.py").read_text()
    raw=operator.command(alias,["sudo","-n","python3","-",node],source,
        timeout=90,ssh_options=_ssh_options(operator,trusted))
    try: report=json.loads(raw)
    except (TypeError,json.JSONDecodeError) as exc: raise ValueError("worker ownership audit returned invalid JSON") from exc
    from worker_scope import REINSTALL_FILES,SHARED_FILES
    files={item.get("path") for item in report.get("files_to_reinstall",[])}
    preserved=set(report.get("preserved_owned_files",[]))
    if (report.get("scope_verified") is not True or report.get("blockers")!=[]
        or report.get("node")!=node or files!=set(REINSTALL_FILES) or preserved!=set(SHARED_FILES)):
        raise ValueError("installed worker owner manifest or file scope failed audit")
    return report


def install_reimage_worker(operator,bootstrap_plan_id,expected_hash):
    plan,source_plan,receipt,observation,trusted,prep=_validated_context(
        operator,bootstrap_plan_id,expected_hash)
    run_path=operator.root/"runs"/(plan["id"]+".json")
    if run_path.exists() or run_path.is_symlink():
        raise ValueError("worker install already has a journal; reconcile it and never replay")
    alias,node=plan["target"]["alias"],plan["target"]["node"]
    operator.events=[];operator.journal_path=run_path
    operator.journal={"id":plan["id"],"operation":"provider-reimage-worker-install",
        "plan_hash":expected_hash,"source_reimage_plan":plan["source_reimage_plan"],
        "status":"running","started_at":_now(),"target":node,"target_alias":alias,
        "worker_payload_sha256":plan["worker_payload_sha256"],"events":[]}
    operator.stage("preflight")
    try:
        health=_check_health(operator)
        operator.journal["core_health_before"]=health
        _cluster_unchanged(operator,source_plan)
        _other_hosts_unchanged(operator,source_plan,alias)
        current=_read_replacement(operator,alias,receipt,observation,trusted)
        operator.journal["replacement_identity_revalidated"]={
            "machine_id":current["machine_id"],"boot_id":current["boot_id"],
            "tailscale_ipv4":current["tailscale_ipv4"],"host_key_file_check":trusted}
        raw_key=operator.command(operator.core["alias"],
            ["sudo","-n","cat","/etc/eru/ssh_key.pub"],record_output=False).strip()
        core_ip=plan["worker_payload"]["core_ip"]
        key=_approved_worker_key(operator,raw_key,core_ip)
        preflight=_preflight(operator,plan,key,trusted)
        operator.journal["install_preflight"]=preflight
        _check_health(operator)
        _cluster_unchanged(operator,source_plan)
        operator.stage("installing-worker-"+node)

        config=dict(plan["worker_payload"]);config["authorized_key"]=key
        install_input="CONFIG="+repr(config)+"\n"+(operator.project/"scripts/remote_install.py").read_text()
        operator.journal["installer_input_sha256"]=hashlib.sha256(install_input.encode()).hexdigest()
        operator.journal["remote_mutation_attempted"]=True
        operator.journal["remote_mutation_performed"]=None
        operator.journal["installer_scope"]={"role":"worker","start_units":config["start_units"],
            "artifact_repositories":sorted(item["repository"] for item in config["artifacts"]),
            "file_count":len(config["files"]),"authorized_key_recorded":False}
        operator.save_journal()
        operator.command(alias,["sudo","-n","python3","-"],install_input,
                         timeout=600,ssh_options=_ssh_options(operator,trusted),record_output=False)
        operator.journal["remote_mutation_performed"]=True
        operator.stage("verifying-worker-"+node)
        audit=_worker_audit(operator,plan,trusted)
        facts=_post_facts(operator,plan,trusted)
        _check_health(operator)
        _cluster_unchanged(operator,source_plan)
        operator.journal["worker_audit"]={k:audit[k] for k in
            ("scope_verified","manifest_sha256","node","files_to_reinstall","preserved_owned_files")}
        operator.journal["post_install"]={
            "machine_id":facts["machine_id"],"boot_id":facts["boot_id"],
            "services":facts["services"],"runtime_counts":facts["runtime_counts"],
            "docker_containers":facts["docker_containers"],
            "agent_active_state":facts["agent_active_state"],"agent_unit_state":facts["agent_unit_state"],
            "proxy_socket_active_state":facts["proxy_socket_active_state"],
            "proxy_socket_unit_state":facts["proxy_socket_unit_state"]}
        operator.journal.update(status="installed-awaiting-registration",finished_at=_now(),
            agent_started=False,node_registered=False,remote_mutation_performed=True)
        operator.stage("awaiting-registration")
        return operator.journal
    except BaseException as exc:
        operator.journal.update(status="failed",failed_at=operator.journal["stage"],
                                error=str(exc),finished_at=_now())
        operator.save_journal()
        raise


def _reconcile_context(operator,journal):
    from reimage_receipt import verify_local_hostkeys
    plan_id=journal.get("bootstrap_plan_id",journal.get("id"))
    plan=_bootstrap(operator,plan_id,journal.get("plan_hash"))
    source=plan.get("source_reimage_plan",{})
    source_env,_=_read_json(operator.root/"plans"/(source.get("id","")+".json"),"source reimage plan")
    source_plan=source_env.get("plan")
    if (not isinstance(source_plan,dict) or digest(source_plan)!=source_env.get("sha256")
        or source_env.get("sha256")!=source.get("sha256")):
        raise ValueError("source reimage plan hash mismatch during reconciliation")
    alias=plan["target"].get("alias")
    if alias not in {"ckc-disposable-02","ckc-disposable-03","ckc-disposable-04"}:
        raise ValueError("worker reconcile target is not a reviewed SSH alias")
    if journal.get("target_alias")!=alias or journal.get("target")!=plan["target"].get("node"):
        raise ValueError("worker install journal target differs from its plan")
    record,record_sha=_read_json(operator.root/"reimage-receipts"/(source["id"]+".json"),"owner receipt record")
    if record_sha!=plan.get("source_receipt_record_sha256"):
        raise ValueError("owner receipt record hash changed during reconciliation")
    receipt=record.get("receipt")
    if (record.get("plan_id")!=source["id"] or record.get("plan_sha256")!=source["sha256"]
        or record.get("status")!="owner-receipt-recorded" or not isinstance(receipt,dict)):
        raise ValueError("owner receipt record is unavailable for read-only reconciliation")
    trusted=verify_local_hostkeys(alias,receipt.get("host_key_fingerprints"),operator.trusted_hostkeys_dir)
    if trusted!=record.get("trusted_host_key_file_check"):
        raise ValueError("trusted replacement host key changed during reconciliation")
    return plan,source_plan,receipt,trusted


def _validate_alias_locally(operator,alias):
    from reimage_host import _ssh_config
    event={"at":_now(),"host":alias,"argv":["ssh","-G",alias],"status":"started"}
    operator.events.append(event);operator.save_journal()
    try:
        p=subprocess.run(["ssh","-G",alias],capture_output=True,text=True,check=False,timeout=20)
    except BaseException as exc:
        event.update(status="uncertain",error=type(exc).__name__);operator.save_journal();raise
    event.update(status="complete",exit_code=p.returncode,stdout=p.stdout,stderr=p.stderr)
    operator.save_journal()
    if p.returncode: raise ValueError("replacement worker SSH alias cannot be resolved")
    _ssh_config(p.stdout,alias)


def reconcile_worker_install(operator,run_id,journal=None):
    """Read the worker and core after an install attempt; never replay its installer."""
    from labctl import identifier,read
    run_id=_identifier(run_id)
    path=operator.root/"runs"/(identifier(run_id)+".json")
    if path.is_symlink() or not path.is_file(): raise ValueError("worker install journal is missing or unsafe")
    journal=journal if journal is not None else read(path)
    if journal.get("operation")!="provider-reimage-worker-install":
        raise ValueError("journal is not a worker-only reimage installation")
    result={"at":_now(),"policy":"Read-only worker/core reconciliation; no installer, registration or service command is replayed.",
            "remote_mutation_performed":False}
    try:
        plan,source_plan,receipt,trusted=_reconcile_context(operator,journal)
    except BaseException as exc:
        result["error"]="plan/trust: "+type(exc).__name__+": "+str(exc)
        plan=None
    if plan is not None:
        alias=plan["target"]["alias"]
        try:
            _validate_alias_locally(operator,alias)
            audit=_worker_audit(operator,plan,trusted)
            facts=_post_facts(operator,plan,trusted)
            result["worker"]={"scope_verified":audit.get("scope_verified"),
                "node":audit.get("node"),"manifest_sha256":audit.get("manifest_sha256"),
                "agent_active_state":facts.get("agent_active_state"),
                "agent_unit_state":facts.get("agent_unit_state"),
                "proxy_socket_active_state":facts.get("proxy_socket_active_state"),
                "proxy_socket_unit_state":facts.get("proxy_socket_unit_state"),
                "runtime_counts":facts.get("runtime_counts")}
        except BaseException as exc:
            result["worker_error"]=type(exc).__name__+": "+str(exc)
        try:
            from reimage_prepare import _cluster
            cluster=_cluster(operator)
            target_rows=[row for row in cluster["nodes"] if row.get("name")==plan["target"]["node"]]
            result["target_registered"]=bool(target_rows)
            result["core_observation"]={
                "target_registration_count":len(target_rows),
                "target_bypass":target_rows[0].get("bypass") if len(target_rows)==1 else None,
                "other_registered_nodes":sorted(row["name"] for row in cluster["nodes"]
                                                  if row.get("name")!=plan["target"]["node"]),
                "target_workload_count":sum(row.get("nodename")==plan["target"]["node"]
                                             for row in cluster["workloads"]),
            }
            try:
                _cluster_unchanged(operator,source_plan)
                result["other_cluster_state_unchanged"]=True
            except BaseException as exc:
                result["other_cluster_state_unchanged"]=False
                result["cluster_state_error"]=type(exc).__name__+": "+str(exc)
        except BaseException as exc:
            result["core_error"]=type(exc).__name__+": "+str(exc)
        try:
            result["core_health"]=_check_health(operator)
        except BaseException as exc:
            result["core_health_error"]=type(exc).__name__+": "+str(exc)
    if journal.get("status")=="running":
        journal.update(status="interrupted",failed_at=journal.get("stage"),reconciled_at=_now())
    else:
        journal["reconciled_at"]=_now()
    journal["reconciliation"]=result
    atomic_json(path,journal)
    return journal
